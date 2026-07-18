jest.mock('../../modules/hr/repositories/attendance.repository', () => ({
  list: jest.fn(),
}));
jest.mock('../../modules/hr/repositories/employeeProfile.repository', () => ({
  findByAccountId: jest.fn(),
  findByEmployeeCode: jest.fn(),
  listByAccountIds: jest.fn(),
}));
jest.mock('../../modules/hr/repositories/leave.repository', () => ({
  listRequests: jest.fn(),
}));
jest.mock('../../modules/hr/repositories/overtime.repository', () => ({
  listRequests: jest.fn(),
}));

const attendanceRepository = require('../../modules/hr/repositories/attendance.repository');
const leaveRepository = require('../../modules/hr/repositories/leave.repository');
const overtimeRepository = require('../../modules/hr/repositories/overtime.repository');
const hrPublic = require('../../modules/hr/public');

const emptyPage = { items: [], pagination: { page: 1, limit: 100, total: 0 } };

describe('hr time public port', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    attendanceRepository.list.mockResolvedValue(emptyPage);
    leaveRepository.listRequests.mockResolvedValue(emptyPage);
    overtimeRepository.listRequests.mockResolvedValue(emptyPage);
  });

  test('exposes safe time reads but no external attendance write port', () => {
    expect(typeof hrPublic.getAttendanceSummaryByProfileIds).toBe('function');
    expect(typeof hrPublic.getApprovedTimeRecords).toBe('function');
    expect(hrPublic.recordExternalAttendance).toBeUndefined();
  });

  test('returns approved time records without reasons, actors, or profile snapshots', async () => {
    leaveRepository.listRequests.mockResolvedValue({
      items: [{
        profileId: 'profile-1',
        status: 'APPROVED',
        reason: 'medical details',
        requesterSnapshot: { fullName: 'Sensitive Name' },
        decision: { actorName: 'Leader', reason: 'private' },
        attendanceStatus: 'PAID_LEAVE',
        workingDateSnapshots: [
          { dateKey: '2026-07-20', units: 2 },
          { dateKey: '2026-07-21', units: 2 },
        ],
      }],
      pagination: { page: 1, limit: 100, total: 1 },
    });
    overtimeRepository.listRequests.mockResolvedValue({
      items: [{
        profileId: 'profile-1',
        workDateKey: '2026-07-20',
        status: 'APPROVED',
        approvedMinutes: 90,
        reason: 'private',
        requesterSnapshot: { fullName: 'Sensitive Name' },
        decision: { actorName: 'Leader' },
      }],
      pagination: { page: 1, limit: 100, total: 1 },
    });

    const result = await hrPublic.getApprovedTimeRecords('profile-1', {
      dateFrom: '2026-07-20',
      dateTo: '2026-07-20',
    });

    expect(result).toEqual({
      profileId: 'profile-1',
      leave: [{
        profileId: 'profile-1',
        workDateKey: '2026-07-20',
        attendanceState: 'PAID_LEAVE',
        approvedLeaveUnits: 2,
      }],
      overtime: [{
        profileId: 'profile-1',
        workDateKey: '2026-07-20',
        approvedOvertimeMinutes: 90,
      }],
    });
    expect(JSON.stringify(result)).not.toMatch(/reason|actor|fullName|requesterSnapshot/i);
    expect(leaveRepository.listRequests).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'profile-1',
      status: 'APPROVED',
    }));
    expect(overtimeRepository.listRequests).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'profile-1',
      status: 'APPROVED',
    }));
  });

  test('represents mixed paid and unpaid half-days deterministically', async () => {
    leaveRepository.listRequests.mockResolvedValue({
      items: [
        {
          profileId: 'profile-1',
          attendanceStatus: 'UNPAID_LEAVE',
          workingDateSnapshots: [{ dateKey: '2026-07-20', units: 1 }],
        },
        {
          profileId: 'profile-1',
          attendanceStatus: 'PAID_LEAVE',
          workingDateSnapshots: [{ dateKey: '2026-07-20', units: 1 }],
        },
      ],
      pagination: { page: 1, limit: 100, total: 2 },
    });

    const result = await hrPublic.getApprovedTimeRecords('profile-1', {
      dateFrom: '2026-07-20',
      dateTo: '2026-07-20',
    });

    expect(result.leave).toEqual([{
      profileId: 'profile-1',
      workDateKey: '2026-07-20',
      attendanceState: 'MIXED_LEAVE',
      approvedLeaveUnits: 2,
    }]);
  });

  test('merges attendance, approved leave, and approved overtime by profile and work date', async () => {
    attendanceRepository.list.mockResolvedValue({
      items: [{
        profileId: 'profile-1',
        workDateKey: '2026-07-20',
        status: 'HALF_DAY',
        manualAdjustments: [{ actorName: 'Hidden' }],
        scheduleSnapshot: { departmentId: 'hidden' },
      }],
      pagination: { page: 1, limit: 100, total: 1 },
    });
    leaveRepository.listRequests.mockResolvedValue({
      items: [{
        profileId: 'profile-1',
        attendanceStatus: 'PAID_LEAVE',
        workingDateSnapshots: [{ dateKey: '2026-07-20', units: 1 }],
      }],
      pagination: { page: 1, limit: 100, total: 1 },
    });
    overtimeRepository.listRequests.mockResolvedValue({
      items: [{ profileId: 'profile-1', workDateKey: '2026-07-21', approvedMinutes: 60 }],
      pagination: { page: 1, limit: 100, total: 1 },
    });

    const result = await hrPublic.getAttendanceSummaryByProfileIds(
      ['profile-1', 'profile-1'],
      { dateFrom: '2026-07-20', dateTo: '2026-07-21' },
    );

    expect(result).toEqual([
      {
        profileId: 'profile-1',
        workDateKey: '2026-07-20',
        attendanceState: 'HALF_DAY',
        approvedLeaveUnits: 1,
        approvedOvertimeMinutes: 0,
      },
      {
        profileId: 'profile-1',
        workDateKey: '2026-07-21',
        attendanceState: null,
        approvedLeaveUnits: 0,
        approvedOvertimeMinutes: 60,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/manualAdjustments|scheduleSnapshot|actor/i);
    expect(attendanceRepository.list).toHaveBeenCalledTimes(1);
  });
});
