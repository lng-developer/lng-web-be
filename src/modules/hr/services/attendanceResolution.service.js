const EMPLOYER_PAID_LEAVE_TYPES = new Set(['ANNUAL', 'BEREAVEMENT', 'WEDDING', 'PERSONAL_PAID']);
const STATUTORY_LEAVE_STATUSES = {
  SICK: 'SICK_LEAVE',
  MATERNITY: 'MATERNITY_LEAVE',
  PATERNITY: 'PATERNITY_LEAVE',
};

function minutes(value) {
  if (!value) return null;
  const [hour, minute] = String(value).split(':').map(Number);
  return Number.isInteger(hour) && Number.isInteger(minute) ? (hour * 60) + minute : null;
}

function calculateSwipe(swipe = {}, config = {}) {
  const blockMinutes = config.blockMinutes ?? 15;
  const standardIn = config.standardInMin ?? 480;
  const standardOut = config.standardOutMin ?? 1050;
  const morningEnd = config.morningEndMin ?? 690;
  const afternoonStart = config.afternoonStartMin ?? 780;
  const morningBlocks = Math.max(0, Math.round((Math.min(morningEnd, standardOut) - standardIn) / blockMinutes));
  const afternoonBlocks = Math.max(0, Math.round((standardOut - Math.max(afternoonStart, standardIn)) / blockMinutes));
  const totalBlocks = config.forcedTotalBlocks ?? morningBlocks + afternoonBlocks;
  const checkIn = minutes(swipe.checkIn);
  const checkOut = minutes(swipe.checkOut);

  if (checkIn === null && checkOut === null) return { workDayValue: 0, attendanceStatus: 'ABSENT' };
  if ((checkIn === null) !== (checkOut === null)) return { workDayValue: 0, attendanceStatus: 'ERROR' };

  let availableBlocks = morningBlocks + afternoonBlocks;
  let deviation = Math.max(0, checkIn - standardIn) + Math.max(0, standardOut - checkOut);
  let attendanceStatus = 'PRESENT';

  if (checkOut <= morningEnd) {
    availableBlocks = morningBlocks;
    deviation = Math.max(0, checkIn - standardIn) + Math.max(0, morningEnd - checkOut);
    attendanceStatus = 'HALF_DAY';
  } else if (checkIn >= afternoonStart) {
    availableBlocks = afternoonBlocks;
    deviation = Math.max(0, checkIn - afternoonStart) + Math.max(0, standardOut - checkOut);
    attendanceStatus = 'HALF_DAY';
  } else if (checkIn > morningEnd && checkIn < afternoonStart) {
    availableBlocks = afternoonBlocks;
    deviation = Math.max(0, standardOut - checkOut);
    attendanceStatus = 'HALF_DAY';
  }

  const earnedBlocks = Math.max(0, availableBlocks - Math.ceil(deviation / blockMinutes));
  return {
    workDayValue: Number((earnedBlocks / totalBlocks).toFixed(4)),
    attendanceStatus,
  };
}

function isApplicablePaidHoliday(holiday) {
  return Boolean(
    holiday?.isApplicable
    && holiday.isWorkDay !== true
    && (holiday.isPaid || holiday.holidayType === 'PUBLIC_HOLIDAY'),
  );
}

function fixedResult(status, workDayValue, calculationReason) {
  return { status, workDayValue, leaveRequestId: null, calculationReason };
}

function leaveResult({ leave, swipe, shiftConfig, leaveValues }) {
  const adjustedConfig = { ...shiftConfig };
  if (leave.leaveScope === 'MORNING') adjustedConfig.standardInMin = shiftConfig?.afternoonStartMin ?? 780;
  if (leave.leaveScope === 'AFTERNOON') adjustedConfig.standardOutMin = shiftConfig?.morningEndMin ?? 690;
  if (leave.leaveScope === 'FULL_DAY') {
    adjustedConfig.standardInMin = adjustedConfig.standardOutMin ?? 1050;
    adjustedConfig.standardOutMin = adjustedConfig.standardInMin;
  }
  const swipeCalculation = calculateSwipe(swipe, adjustedConfig);
  const status = leave.attendanceStatus
    || STATUTORY_LEAVE_STATUSES[leave.leaveType]
    || (EMPLOYER_PAID_LEAVE_TYPES.has(leave.leaveType) ? 'PAID_LEAVE' : 'UNPAID_LEAVE');
  const paid = status === 'PAID_LEAVE';
  let workDayValue;
  if (Number.isFinite(leave.workDayValue)) {
    workDayValue = leave.workDayValue;
  } else if (leave.leaveScope === 'FULL_DAY') {
    workDayValue = paid ? 1 : 0;
  } else {
    const leaveValue = leave.leaveScope === 'MORNING'
      ? (leaveValues?.morningValue ?? 0)
      : (leaveValues?.afternoonValue ?? 0);
    workDayValue = paid ? Math.min(1, swipeCalculation.workDayValue + leaveValue) : swipeCalculation.workDayValue;
  }
  return {
    status,
    workDayValue,
    leaveRequestId: leave.id || leave._id || leave.requestId || null,
    calculationReason: 'APPROVED_LEAVE',
    swipeCalculation,
  };
}

function resolveAttendanceDay(input = {}) {
  if (input.existingAttendance?.isManualEdited) {
    return {
      status: input.existingAttendance.status,
      workDayValue: input.existingAttendance.workDayValue,
      leaveRequestId: input.existingAttendance.leaveRequestId || input.existingAttendance.leaveId || null,
      calculationReason: 'MANUAL',
    };
  }
  if (isApplicablePaidHoliday(input.holiday)) return fixedResult('HOLIDAY', 1, 'PAID_HOLIDAY');
  if (input.isSunday || input.isRotationOff) return fixedResult('REST_DAY', 0, 'REST_DAY');
  if (input.leave?.status === 'APPROVED') return leaveResult(input);

  const swipeCalculation = calculateSwipe(input.swipe, input.shiftConfig);
  return {
    status: swipeCalculation.attendanceStatus,
    workDayValue: swipeCalculation.workDayValue,
    leaveRequestId: null,
    calculationReason: swipeCalculation.attendanceStatus === 'ABSENT' ? 'ABSENT' : 'SWIPE',
    swipeCalculation,
  };
}

module.exports = { resolveAttendanceDay };
