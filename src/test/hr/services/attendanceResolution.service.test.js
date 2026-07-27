const { legacyAttendanceResolutionCases } = require('../fixtures/legacyAttendanceResolution.cases');
const { resolveAttendanceDay } = require('../../../modules/hr/services/attendanceResolution.service');

function newContract(expected) {
  return {
    status: expected.status,
    workDayValue: expected.workDayValue,
    leaveRequestId: expected.leaveId,
    calculationReason: expected.calculationReason,
    ...(expected.swipeCalculation ? { swipeCalculation: expected.swipeCalculation } : {}),
  };
}

describe('attendance day resolution parity', () => {
  test.each(legacyAttendanceResolutionCases)('$name', ({ input, expected }) => {
    const inputs = Array.isArray(input) ? input : [input];
    const outputs = Array.isArray(expected) ? expected : [expected];

    inputs.forEach((item, index) => {
      expect(resolveAttendanceDay(item)).toEqual(newContract(outputs[index]));
    });
  });

  test('returns the approved request id through the POD contract', () => {
    expect(resolveAttendanceDay({
      leave: { id: 'leave-42', status: 'APPROVED', leaveType: 'ANNUAL', leaveScope: 'FULL_DAY' },
    })).toEqual({
      status: 'PAID_LEAVE',
      workDayValue: 1,
      leaveRequestId: 'leave-42',
      calculationReason: 'APPROVED_LEAVE',
      swipeCalculation: { workDayValue: 0, attendanceStatus: 'ABSENT' },
    });
  });

  test('keeps an explicitly aggregated mixed-leave value', () => {
    expect(resolveAttendanceDay({
      leave: {
        status: 'APPROVED',
        attendanceStatus: 'MIXED_LEAVE',
        leaveScope: 'FULL_DAY',
        workDayValue: 0.5,
      },
    })).toEqual({
      status: 'MIXED_LEAVE',
      workDayValue: 0.5,
      leaveRequestId: null,
      calculationReason: 'APPROVED_LEAVE',
      swipeCalculation: { workDayValue: 0, attendanceStatus: 'ABSENT' },
    });
  });
});
