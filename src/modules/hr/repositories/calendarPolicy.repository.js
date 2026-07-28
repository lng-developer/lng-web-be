const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const Holiday = require('../models/holiday.model');
const SaturdayRotation = require('../models/saturdayRotation.model');

function dateFilter({ dateFrom, dateTo } = {}) {
  if (!dateFrom && !dateTo) return undefined;
  return { ...(dateFrom ? { $gte: dateFrom } : {}), ...(dateTo ? { $lte: dateTo } : {}) };
}

function applicabilityFilters({ departmentId, teamId } = {}) {
  return [
    { $or: [{ 'appliedDepartmentIds.0': { $exists: false } }, ...(departmentId ? [{ appliedDepartmentIds: departmentId }] : [])] },
    { $or: [{ 'appliedTeamIds.0': { $exists: false } }, ...(teamId ? [{ appliedTeamIds: teamId }] : [])] },
  ];
}

function buildHolidayFilter(query = {}) {
  const filter = { isActive: query.isActive ?? true };
  const range = dateFilter(query);
  if (range) filter.dateKey = range;
  if (query.holidayType) filter.holidayType = query.holidayType;
  if (query.isWorkDay !== undefined) filter.isWorkDay = query.isWorkDay;
  if (query.departmentId || query.teamId) filter.$and = applicabilityFilters(query);
  return filter;
}

async function findApplicable({ dateKey, departmentId, teamId } = {}) {
  return Holiday.findOne({
    dateKey,
    isActive: true,
    $and: applicabilityFilters({ departmentId, teamId }),
  }).lean();
}

async function listHolidays(query = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = buildHolidayFilter(query);
  const [items, total] = await Promise.all([
    Holiday.find(filter).sort({ dateKey: 1, _id: 1 }).skip(getPaginationOffset({ page, limit })).limit(limit).lean(),
    Holiday.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total } };
}

async function listHolidayRange(query = {}) {
  return Holiday.find(buildHolidayFilter(query)).sort({ dateKey: 1, _id: 1 }).lean();
}

async function findHolidayById(id) {
  return Holiday.findById(id).lean();
}

async function createHoliday(payload) {
  const holiday = await Holiday.create(payload);
  return holiday.toObject();
}

async function updateHoliday(id, patch) {
  return Holiday.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after', runValidators: true }).lean();
}

async function softDeleteHoliday(id) {
  return updateHoliday(id, { isActive: false });
}

function buildRotationFilter(query = {}) {
  return {
    ...(query.teamId ? { teamId: query.teamId } : {}),
    ...(query.month ? { month: query.month } : {}),
    ...(query.year ? { year: query.year } : {}),
  };
}

async function listRotations(query = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = buildRotationFilter(query);
  const [items, total] = await Promise.all([
    SaturdayRotation.find(filter).sort({ workDateKey: 1, _id: 1 }).skip(getPaginationOffset({ page, limit })).limit(limit).lean(),
    SaturdayRotation.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total } };
}

async function findRotationById(id) {
  return SaturdayRotation.findById(id).lean();
}

async function isRotationOff(profileId, workDateKey, teamId) {
  return Boolean(await SaturdayRotation.findOne({ teamId, workDateKey, employeeProfileIds: profileId }).select('_id').lean());
}

async function upsertRotation(payload) {
  return SaturdayRotation.findOneAndUpdate(
    { teamId: payload.teamId, workDateKey: payload.workDateKey },
    { $set: payload },
    { returnDocument: 'after', runValidators: true, upsert: true },
  ).lean();
}

async function updateRotation(id, patch) {
  return SaturdayRotation.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after', runValidators: true }).lean();
}

async function deleteRotation(id) {
  return SaturdayRotation.findByIdAndDelete(id).lean();
}

async function deleteTeamRotations(teamId, month, year) {
  return SaturdayRotation.deleteMany({ teamId, month, year });
}

module.exports = {
  createHoliday,
  deleteRotation,
  deleteTeamRotations,
  findApplicable,
  findHolidayById,
  findRotationById,
  isRotationOff,
  listHolidayRange,
  listHolidays,
  listRotations,
  softDeleteHoliday,
  updateHoliday,
  updateRotation,
  upsertRotation,
};
