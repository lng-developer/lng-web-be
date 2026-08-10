const { toAttendanceDto } = require('../../../src/modules/hr/dtos/attendance.dto');
const {
  toAssignmentDto,
  toCalendarOverrideDto,
} = require('../../../src/modules/hr/dtos/schedule.dto');
const {
  toEmployeeProfileDetailDto,
  toEmployeeProfileDirectoryDto,
} = require('../../../src/modules/hr/dtos/employeeProfile.dto');

const employee = { id: 'profile-1', employeeCode: 'EMP-001', fullName: 'Nguyen Van A' };
const department = { id: 'department-1', code: 'OPS', name: 'Operations' };
const team = { id: 'team-1', code: 'OPS-A', name: 'Operations A' };

describe('operator response DTOs', () => {
  test('adds attendance display summaries and the resolved adjustment capability', () => {
    expect(toAttendanceDto({
      _id: 'attendance-1',
      profileId: employee.id,
      scheduleSnapshot: {
        shift: { id: 'shift-1', code: 'DAY', name: 'Day shift' },
        workLocation: { id: 'location-1', code: 'HCM', name: 'HCM Office' },
      },
    }, { employee, capabilities: { view: true, adjust: true } })).toMatchObject({
      employee,
      shift: { id: 'shift-1', code: 'DAY', name: 'Day shift' },
      workLocation: { id: 'location-1', code: 'HCM', name: 'HCM Office' },
      capabilities: { view: true, adjust: true },
    });
  });

  test('adds assignment and calendar scope display summaries', () => {
    expect(toAssignmentDto({
      _id: 'assignment-1', profileId: employee.id, shiftId: 'shift-1', workLocationId: 'location-1',
    }, {
      employee,
      shift: { id: 'shift-1', code: 'DAY', name: 'Day shift' },
      workLocation: { id: 'location-1', code: 'HCM', name: 'HCM Office' },
      capabilities: { view: true, edit: true },
    })).toMatchObject({
      employee,
      shift: { id: 'shift-1', code: 'DAY', name: 'Day shift' },
      workLocation: { id: 'location-1', code: 'HCM', name: 'HCM Office' },
      capabilities: { view: true, edit: true },
    });
    expect(toCalendarOverrideDto({
      _id: 'override-1', scopeType: 'PROFILE', scopeId: employee.id,
    }, { scopeTarget: employee, capabilities: { view: true, edit: true } })).toMatchObject({
      scopeTarget: employee,
      capabilities: { view: true, edit: true },
    });
  });

  test.each([
    ['directory', toEmployeeProfileDirectoryDto],
    ['detail', toEmployeeProfileDetailDto],
  ])('adds organization summaries to the employee %s display', (_kind, toDto) => {
    expect(toDto({ _id: employee.id, accountId: 'account-1' }, { department, team })).toMatchObject({
      department,
      team,
    });
  });
});
