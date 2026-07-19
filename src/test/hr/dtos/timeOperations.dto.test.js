const { toLeaveRequestDto } = require('../../../modules/hr/dtos/leave.dto');
const { toOvertimeRequestDto } = require('../../../modules/hr/dtos/overtime.dto');

const requesterSnapshot = {
  profileId: 'profile-1',
  employeeCode: 'EMP-001',
  fullName: 'Nguyen Van A',
};

describe('time operation request DTOs', () => {
  test.each([
    ['leave', toLeaveRequestDto],
    ['overtime', toOvertimeRequestDto],
  ])('returns a human-readable requester summary for %s requests', (_kind, toDto) => {
    expect(toDto({ _id: 'request-1', profileId: 'profile-1', requesterSnapshot })).toMatchObject({
      employee: { id: 'profile-1', employeeCode: 'EMP-001', fullName: 'Nguyen Van A' },
    });
  });
});
