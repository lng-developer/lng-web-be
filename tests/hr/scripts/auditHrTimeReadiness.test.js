const fs = require('fs');
const path = require('path');

jest.mock('../../../src/config/database', () => ({
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
}));
jest.mock('../../../src/shared/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('../../../src/modules/hr/models/employeeProfile.model', () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
}));
jest.mock('../../../src/modules/hr/models/shiftAssignment.model', () => ({
  aggregate: jest.fn(),
  find: jest.fn(),
}));

const EmployeeProfile = require('../../../src/modules/hr/models/employeeProfile.model');
const ShiftAssignment = require('../../../src/modules/hr/models/shiftAssignment.model');
const {
  collectHrTimeReadiness,
  dateKeyInTimezone,
} = require('../../../src/modules/hr/scripts/auditHrTimeReadiness');

function leanResult(value) {
  return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }) };
}

describe('audit HR time readiness script', () => {
  beforeEach(() => jest.clearAllMocks());

  test('reports active profiles without assignments and overlapping active windows', async () => {
    EmployeeProfile.countDocuments.mockResolvedValue(2);
    EmployeeProfile.find.mockReturnValue(leanResult([
      { _id: 'profile-1', employeeCode: 'A1' },
      { _id: 'profile-2', employeeCode: 'A2' },
    ]));
    ShiftAssignment.find.mockReturnValue(leanResult([{ profileId: 'profile-1' }]));
    ShiftAssignment.aggregate.mockResolvedValue([{
      _id: 'profile-1',
      windows: [
        { assignmentId: 'assignment-1', effectiveFrom: '2026-01-01', effectiveTo: '2026-07-31' },
        { assignmentId: 'assignment-2', effectiveFrom: '2026-07-01', effectiveTo: null },
      ],
    }]);

    const result = await collectHrTimeReadiness({ asOfDate: '2026-07-18' });

    expect(result.totalActiveProfiles).toBe(2);
    expect(result.profilesWithoutActiveAssignment).toEqual([
      { profileId: 'profile-2', employeeCode: 'A2' },
    ]);
    expect(result.duplicateActiveAssignmentWindows).toEqual([{
      profileId: 'profile-1',
      firstAssignmentId: 'assignment-1',
      secondAssignmentId: 'assignment-2',
      firstRange: { effectiveFrom: '2026-01-01', effectiveTo: '2026-07-31' },
      secondRange: { effectiveFrom: '2026-07-01', effectiveTo: null },
    }]);
    expect(EmployeeProfile.countDocuments).toHaveBeenCalledWith({
      isDeleted: false,
      status: 'ACTIVE',
    });
    const effectiveAssignmentFilter = {
      status: 'ACTIVE',
      effectiveFrom: { $lte: '2026-07-18' },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: '2026-07-18' } }],
    };
    expect(ShiftAssignment.find).toHaveBeenCalledWith(effectiveAssignmentFilter);
    expect(ShiftAssignment.aggregate.mock.calls[0][0][0]).toEqual({ $match: { status: 'ACTIVE' } });
  });

  test('reports past and future overlapping ACTIVE assignment windows', async () => {
    EmployeeProfile.countDocuments.mockResolvedValue(1);
    EmployeeProfile.find.mockReturnValue(leanResult([{ _id: 'profile-1', employeeCode: 'A1' }]));
    ShiftAssignment.find.mockReturnValue(leanResult([]));
    ShiftAssignment.aggregate.mockResolvedValue([{
      _id: 'profile-1',
      windows: [
        { assignmentId: 'past-1', effectiveFrom: '2025-01-01', effectiveTo: '2025-06-30' },
        { assignmentId: 'past-2', effectiveFrom: '2025-06-01', effectiveTo: '2025-12-31' },
        { assignmentId: 'future-1', effectiveFrom: '2027-01-01', effectiveTo: '2027-06-30' },
        { assignmentId: 'future-2', effectiveFrom: '2027-06-01', effectiveTo: null },
      ],
    }]);

    const result = await collectHrTimeReadiness({ asOfDate: '2026-07-18' });

    expect(result.profilesWithoutActiveAssignment).toEqual([
      { profileId: 'profile-1', employeeCode: 'A1' },
    ]);
    expect(result.duplicateActiveAssignmentWindows).toHaveLength(2);
    expect(result.duplicateActiveAssignmentWindows.map((item) => item.firstAssignmentId)).toEqual([
      'past-1',
      'future-1',
    ]);
  });

  test('contains no request mutation operation', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../src/modules/hr/scripts/auditHrTimeReadiness.js'),
      'utf8',
    );
    expect(source).not.toMatch(/\.(create|save|updateOne|updateMany|deleteOne|deleteMany|findOneAndUpdate|bulkWrite)\s*\(/);
  });

  test('uses explicit asOfDate and derives timezone-safe operation dates', async () => {
    EmployeeProfile.countDocuments.mockResolvedValue(0);
    EmployeeProfile.find.mockReturnValue(leanResult([]));
    ShiftAssignment.find.mockReturnValue(leanResult([]));
    ShiftAssignment.aggregate.mockResolvedValue([]);

    await collectHrTimeReadiness({ asOfDate: '2026-07-19' });

    expect(ShiftAssignment.find).toHaveBeenCalledWith(expect.objectContaining({
      effectiveFrom: { $lte: '2026-07-19' },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: '2026-07-19' } }],
    }));
    expect(dateKeyInTimezone(
      new Date('2026-07-18T17:30:00.000Z'),
      'Asia/Ho_Chi_Minh',
    )).toBe('2026-07-19');
  });

  test('rejects an invalid operations timezone even with an explicit asOfDate', async () => {
    await expect(collectHrTimeReadiness({
      asOfDate: '2026-07-19',
      timezone: 'Not/A_Timezone',
    })).rejects.toThrow('timezone is invalid');

    expect(EmployeeProfile.countDocuments).not.toHaveBeenCalled();
  });

  test('derives the default asOfDate from the passed operations timezone', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T20:00:00.000Z'));
    EmployeeProfile.countDocuments.mockResolvedValue(0);
    EmployeeProfile.find.mockReturnValue(leanResult([]));
    ShiftAssignment.find.mockReturnValue(leanResult([]));
    ShiftAssignment.aggregate.mockResolvedValue([]);

    try {
      const result = await collectHrTimeReadiness({ timezone: 'America/Los_Angeles' });

      expect(result).toMatchObject({
        asOfDate: '2026-07-18',
        timezone: 'America/Los_Angeles',
      });
      expect(ShiftAssignment.find).toHaveBeenCalledWith(expect.objectContaining({
        effectiveFrom: { $lte: '2026-07-18' },
      }));
    } finally {
      jest.useRealTimers();
    }
  });
});
