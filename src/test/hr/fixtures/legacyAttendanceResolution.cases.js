const legacyAttendanceResolutionCases = [
  {
    name: 'manual record wins over holiday and leave',
    input: {
      existingAttendance: { isManualEdited: true, status: 'PRESENT', workDayValue: 0.75 },
      holiday: { isPaid: true, isApplicable: true },
      leave: { status: 'APPROVED', leaveType: 'UNPAID', leaveScope: 'FULL_DAY' },
    },
    expected: { status: 'PRESENT', workDayValue: 0.75, leaveId: null, isLeaveValid: false, calculationReason: 'MANUAL' },
  },
  {
    name: 'applicable paid holiday wins over leave and swipe',
    input: {
      holiday: { holidayType: 'PUBLIC_HOLIDAY', isApplicable: true, isWorkDay: false },
      leave: { status: 'APPROVED', leaveType: 'UNPAID', leaveScope: 'FULL_DAY' },
      swipe: { checkIn: '08:00', checkOut: '17:30' },
    },
    expected: { status: 'HOLIDAY', workDayValue: 1, leaveId: null, isLeaveValid: false, calculationReason: 'PAID_HOLIDAY' },
  },
  {
    name: 'applicable paid public holiday wins over Sunday',
    input: {
      isSunday: true,
      holiday: { holidayType: 'PUBLIC_HOLIDAY', isApplicable: true, isWorkDay: false },
    },
    expected: { status: 'HOLIDAY', workDayValue: 1, leaveId: null, isLeaveValid: false, calculationReason: 'PAID_HOLIDAY' },
  },
  {
    name: 'Sunday and rotation-off resolve to rest days before leave',
    input: [
      { isSunday: true, leave: { status: 'APPROVED', leaveType: 'ANNUAL', leaveScope: 'FULL_DAY' }, swipe: { checkIn: '08:00', checkOut: '17:30' } },
      { isRotationOff: true, leave: { status: 'APPROVED', leaveType: 'ANNUAL', leaveScope: 'FULL_DAY' }, swipe: { checkIn: '08:00', checkOut: '17:30' } },
    ],
    expected: [
      { status: 'REST_DAY', workDayValue: 0, leaveId: null, isLeaveValid: false, calculationReason: 'REST_DAY' },
      { status: 'REST_DAY', workDayValue: 0, leaveId: null, isLeaveValid: false, calculationReason: 'REST_DAY' },
    ],
  },
  {
    name: 'approved unpaid full-day leave is zero despite complete swipes',
    input: [
      { swipe: { checkIn: '08:00', checkOut: '17:30' }, leave: { status: 'APPROVED', leaveType: 'UNPAID', leaveScope: 'FULL_DAY' }, shiftConfig: { standardInMin: 480, standardOutMin: 1050, morningEndMin: 690, afternoonStartMin: 780, forcedTotalBlocks: 32, blockMinutes: 15 } },
      { swipe: { checkIn: '08:00', checkOut: '17:30' }, leave: { status: 'APPROVED', leaveType: 'PERSONAL_UNPAID', leaveScope: 'FULL_DAY' }, shiftConfig: { standardInMin: 480, standardOutMin: 1050, morningEndMin: 690, afternoonStartMin: 780, forcedTotalBlocks: 32, blockMinutes: 15 } },
    ],
    expected: [
      { status: 'UNPAID_LEAVE', workDayValue: 0, leaveId: null, isLeaveValid: true, calculationReason: 'APPROVED_LEAVE', swipeCalculation: { workDayValue: 0, attendanceStatus: 'PRESENT' } },
      { status: 'UNPAID_LEAVE', workDayValue: 0, leaveId: null, isLeaveValid: true, calculationReason: 'APPROVED_LEAVE', swipeCalculation: { workDayValue: 0, attendanceStatus: 'PRESENT' } },
    ],
  },
  {
    name: 'paid half-day leave adds only the remaining-half swipe value',
    input: {
      swipe: { checkIn: '13:00', checkOut: '17:30' },
      leave: { status: 'APPROVED', leaveType: 'ANNUAL', leaveScope: 'MORNING' },
      shiftConfig: { standardInMin: 480, standardOutMin: 1050, morningEndMin: 690, afternoonStartMin: 780, forcedTotalBlocks: 32, blockMinutes: 15 },
      leaveValues: { morningValue: 0.4375, afternoonValue: 0.5625 },
    },
    expected: { status: 'PAID_LEAVE', workDayValue: 1, leaveId: null, isLeaveValid: true, calculationReason: 'APPROVED_LEAVE', swipeCalculation: { workDayValue: 0.5625, attendanceStatus: 'HALF_DAY' } },
  },
  {
    name: 'unpaid half-day leave keeps only the remaining-half swipe value',
    input: {
      swipe: { checkIn: '08:00', checkOut: '11:30' },
      leave: { status: 'APPROVED', leaveType: 'UNPAID', leaveScope: 'AFTERNOON' },
      shiftConfig: { standardInMin: 480, standardOutMin: 1050, morningEndMin: 690, afternoonStartMin: 780, forcedTotalBlocks: 32, blockMinutes: 15 },
      leaveValues: { morningValue: 0.4375, afternoonValue: 0.5625 },
    },
    expected: { status: 'UNPAID_LEAVE', workDayValue: 0.4375, leaveId: null, isLeaveValid: true, calculationReason: 'APPROVED_LEAVE', swipeCalculation: { workDayValue: 0.4375, attendanceStatus: 'HALF_DAY' } },
  },
  {
    name: 'statutory leave retains its status without employer-paid credit',
    input: [
      { swipe: { checkIn: '08:00', checkOut: '17:30' }, leave: { status: 'APPROVED', leaveType: 'SICK', leaveScope: 'FULL_DAY' }, shiftConfig: { standardInMin: 480, standardOutMin: 1050, morningEndMin: 690, afternoonStartMin: 780, forcedTotalBlocks: 32, blockMinutes: 15 } },
      { swipe: { checkIn: '08:00', checkOut: '17:30' }, leave: { status: 'APPROVED', leaveType: 'MATERNITY', leaveScope: 'FULL_DAY' }, shiftConfig: { standardInMin: 480, standardOutMin: 1050, morningEndMin: 690, afternoonStartMin: 780, forcedTotalBlocks: 32, blockMinutes: 15 } },
      { swipe: { checkIn: '08:00', checkOut: '17:30' }, leave: { status: 'APPROVED', leaveType: 'PATERNITY', leaveScope: 'FULL_DAY' }, shiftConfig: { standardInMin: 480, standardOutMin: 1050, morningEndMin: 690, afternoonStartMin: 780, forcedTotalBlocks: 32, blockMinutes: 15 } },
    ],
    expected: [
      { status: 'SICK_LEAVE', workDayValue: 0, leaveId: null, isLeaveValid: true, calculationReason: 'APPROVED_LEAVE', swipeCalculation: { workDayValue: 0, attendanceStatus: 'PRESENT' } },
      { status: 'MATERNITY_LEAVE', workDayValue: 0, leaveId: null, isLeaveValid: true, calculationReason: 'APPROVED_LEAVE', swipeCalculation: { workDayValue: 0, attendanceStatus: 'PRESENT' } },
      { status: 'PATERNITY_LEAVE', workDayValue: 0, leaveId: null, isLeaveValid: true, calculationReason: 'APPROVED_LEAVE', swipeCalculation: { workDayValue: 0, attendanceStatus: 'PRESENT' } },
    ],
  },
  {
    name: 'missing and one-sided swipes preserve absence and error outcomes',
    input: [
      { swipe: {}, shiftConfig: { standardInMin: 480, standardOutMin: 1050, morningEndMin: 690, afternoonStartMin: 780, forcedTotalBlocks: 32, blockMinutes: 15 } },
      { swipe: { checkIn: '08:00' }, shiftConfig: { standardInMin: 480, standardOutMin: 1050, morningEndMin: 690, afternoonStartMin: 780, forcedTotalBlocks: 32, blockMinutes: 15 } },
    ],
    expected: [
      { status: 'ABSENT', workDayValue: 0, leaveId: null, isLeaveValid: false, calculationReason: 'ABSENT', swipeCalculation: { workDayValue: 0, attendanceStatus: 'ABSENT' } },
      { status: 'ERROR', workDayValue: 0, leaveId: null, isLeaveValid: false, calculationReason: 'SWIPE', swipeCalculation: { workDayValue: 0, attendanceStatus: 'ERROR' } },
    ],
  },
  {
    name: 'overtime fields do not change the resolved workday value',
    input: {
      swipe: { checkIn: '08:00', checkOut: '17:30' },
      shiftConfig: { standardInMin: 480, standardOutMin: 1050, morningEndMin: 690, afternoonStartMin: 780, forcedTotalBlocks: 32, blockMinutes: 15 },
      existingAttendance: { finalOtHours: { weekday: 12 } },
    },
    expected: { status: 'PRESENT', workDayValue: 1, leaveId: null, isLeaveValid: false, calculationReason: 'SWIPE', swipeCalculation: { workDayValue: 1, attendanceStatus: 'PRESENT' } },
  },
];

module.exports = { legacyAttendanceResolutionCases };
