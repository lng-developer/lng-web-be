const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const { hrEmployeeStatuses } = require('../constants/hr.constants');
const EmployeeProfile = require('../models/employeeProfile.model');
const ShiftAssignment = require('../models/shiftAssignment.model');

const DEFAULT_OPERATIONS_TIMEZONE = 'Asia/Ho_Chi_Minh';

function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function overlap(first, second) {
  return first.effectiveFrom <= (second.effectiveTo || '9999-12-31')
    && second.effectiveFrom <= (first.effectiveTo || '9999-12-31');
}

function dateKeyInTimezone(now = new Date(), timezone = DEFAULT_OPERATIONS_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function assertDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('asOfDate must use YYYY-MM-DD');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('asOfDate must be a valid calendar date');
  }
}

function assertTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch (_error) {
    throw new Error('timezone is invalid');
  }
}

async function collectHrTimeReadiness({
  asOfDate,
  timezone = DEFAULT_OPERATIONS_TIMEZONE,
} = {}) {
  assertTimezone(timezone);
  const effectiveAsOfDate = asOfDate || dateKeyInTimezone(new Date(), timezone);
  assertDateKey(effectiveAsOfDate);
  const activeProfileFilter = { isDeleted: false, status: hrEmployeeStatuses.ACTIVE };
  const currentAssignmentFilter = {
    status: hrEmployeeStatuses.ACTIVE,
    effectiveFrom: { $lte: effectiveAsOfDate },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: effectiveAsOfDate } }],
  };
  const activeAssignmentFilter = { status: hrEmployeeStatuses.ACTIVE };
  const [totalActiveProfiles, profiles, assignments, groupedWindows] = await Promise.all([
    EmployeeProfile.countDocuments(activeProfileFilter),
    EmployeeProfile.find(activeProfileFilter).select('_id employeeCode').lean(),
    ShiftAssignment.find(currentAssignmentFilter).select('profileId').lean(),
    ShiftAssignment.aggregate([
      { $match: activeAssignmentFilter },
      { $sort: { profileId: 1, effectiveFrom: 1, _id: 1 } },
      {
        $group: {
          _id: '$profileId',
          windows: {
            $push: {
              assignmentId: '$_id',
              effectiveFrom: '$effectiveFrom',
              effectiveTo: '$effectiveTo',
            },
          },
        },
      },
    ]),
  ]);
  const assignedProfileIds = new Set(assignments.map((assignment) => toId(assignment.profileId)));
  const profilesWithoutActiveAssignment = profiles
    .filter((profile) => !assignedProfileIds.has(toId(profile)))
    .map((profile) => ({ profileId: toId(profile), employeeCode: profile.employeeCode || null }));
  const duplicateActiveAssignmentWindows = [];
  for (const group of groupedWindows) {
    for (let firstIndex = 0; firstIndex < group.windows.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < group.windows.length; secondIndex += 1) {
        const first = group.windows[firstIndex];
        const second = group.windows[secondIndex];
        if (!overlap(first, second)) continue;
        duplicateActiveAssignmentWindows.push({
          profileId: toId(group._id),
          firstAssignmentId: toId(first.assignmentId),
          secondAssignmentId: toId(second.assignmentId),
          firstRange: { effectiveFrom: first.effectiveFrom, effectiveTo: first.effectiveTo || null },
          secondRange: { effectiveFrom: second.effectiveFrom, effectiveTo: second.effectiveTo || null },
        });
      }
    }
  }
  return {
    asOfDate: effectiveAsOfDate,
    timezone,
    totalActiveProfiles,
    profilesWithoutActiveAssignment,
    duplicateActiveAssignmentWindows,
  };
}

async function auditHrTimeReadiness(options = {}) {
  await connectDatabase();
  try {
    const result = await collectHrTimeReadiness(options);
    logger.info('HR time readiness audit', result);
    return result;
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  const asOfArg = process.argv.find((argument) => argument.startsWith('--as-of='));
  const timezoneArg = process.argv.find((argument) => argument.startsWith('--timezone='));
  const timezone = timezoneArg?.slice('--timezone='.length)
    || process.env.HR_OPERATIONS_TIMEZONE
    || DEFAULT_OPERATIONS_TIMEZONE;
  const asOfDate = asOfArg?.slice('--as-of='.length) || dateKeyInTimezone(new Date(), timezone);
  auditHrTimeReadiness({ asOfDate, timezone }).catch((error) => {
    logger.error('HR time readiness audit failed', { error });
    process.exitCode = 1;
  });
}

module.exports = {
  auditHrTimeReadiness,
  collectHrTimeReadiness,
  dateKeyInTimezone,
  DEFAULT_OPERATIONS_TIMEZONE,
};
