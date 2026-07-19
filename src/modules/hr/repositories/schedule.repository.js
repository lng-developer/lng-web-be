const { hrEmployeeStatuses } = require('../constants/hr.constants');
const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const { buildCaseInsensitivePrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');

function models() {
  return {
    CalendarOverride: require('../models/calendarOverride.model'),
    Shift: require('../models/shift.model'),
    ShiftAssignment: require('../models/shiftAssignment.model'),
    WorkLocation: require('../models/workLocation.model'),
  };
}

function buildListFilter({ q, status } = {}) {
  const filter = status ? { status } : {};
  const search = normalizeSearchTerm(q);
  if (search) {
    const value = buildCaseInsensitivePrefixRegex(search);
    filter.$or = [{ code: value }, { name: value }];
  }
  return filter;
}

async function listRecords(Model, query = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = buildListFilter(query);
  const [items, total] = await Promise.all([
    Model.find(filter)
      .sort({ code: 1, name: 1, _id: 1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    Model.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total } };
}

async function createRecord(Model, payload) {
  const [record] = await Model.create([payload]);
  return record.toObject();
}

async function updateRecord(Model, id, patch) {
  return Model.findByIdAndUpdate(
    id,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function listWorkLocations(query) {
  return listRecords(models().WorkLocation, query);
}

async function createWorkLocation(payload) {
  return createRecord(models().WorkLocation, payload);
}

async function findWorkLocationById(id) {
  return models().WorkLocation.findById(id).lean();
}

async function findWorkLocationsByIds(ids = []) {
  const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
  if (!uniqueIds.length) return [];
  return models().WorkLocation.find({ _id: { $in: uniqueIds } }).lean();
}

async function updateWorkLocationById(id, patch) {
  return updateRecord(models().WorkLocation, id, patch);
}

async function listShifts(query) {
  return listRecords(models().Shift, query);
}

async function createShift(payload) {
  return createRecord(models().Shift, payload);
}

async function findShiftById(id) {
  return models().Shift.findById(id).lean();
}

async function findShiftsByIds(ids = []) {
  const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
  if (!uniqueIds.length) return [];
  return models().Shift.find({ _id: { $in: uniqueIds } }).lean();
}

async function updateShiftById(id, patch) {
  return updateRecord(models().Shift, id, patch);
}

async function listAssignments(query = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = {};
  if (query.profileId) filter.profileId = query.profileId;
  if (query.profileIds) {
    if (query.profileId) {
      delete filter.profileId;
      filter.$and = [
        { profileId: query.profileId },
        { profileId: { $in: query.profileIds } },
      ];
    } else {
      filter.profileId = { $in: query.profileIds };
    }
  }
  if (query.shiftId) filter.shiftId = query.shiftId;
  if (query.workLocationId) filter.workLocationId = query.workLocationId;
  if (query.status) filter.status = query.status;
  const [items, total] = await Promise.all([
    models().ShiftAssignment.find(filter)
      .sort({ effectiveFrom: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    models().ShiftAssignment.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total } };
}

async function createAssignment(payload) {
  return createRecord(models().ShiftAssignment, payload);
}

async function findAssignmentById(id) {
  return models().ShiftAssignment.findById(id).lean();
}

async function updateAssignmentById(id, patch) {
  return updateRecord(models().ShiftAssignment, id, patch);
}

async function findAssignmentOverlaps(profileId, effectiveFrom, effectiveTo, excludedId) {
  const filter = {
    profileId,
    status: hrEmployeeStatuses.ACTIVE,
    effectiveFrom: { $lte: effectiveTo || '9999-12-31' },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: effectiveFrom } }],
  };
  if (excludedId) filter._id = { $ne: excludedId };
  return models().ShiftAssignment.find(filter).lean();
}

async function listCalendarOverrides(query = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = {};
  if (query.dateKey) filter.dateKey = query.dateKey;
  if (query.scopeType) filter.scopeType = query.scopeType;
  if (Object.hasOwn(query, 'scopeId')) filter.scopeId = query.scopeId;
  if (query.status) filter.status = query.status;
  if (query.scopeFilters?.length) filter.$or = query.scopeFilters;
  const [items, total] = await Promise.all([
    models().CalendarOverride.find(filter)
      .sort({ dateKey: -1, scopeType: 1, _id: 1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    models().CalendarOverride.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total } };
}

async function createCalendarOverride(payload) {
  return createRecord(models().CalendarOverride, payload);
}

async function findCalendarOverrideById(id) {
  return models().CalendarOverride.findById(id).lean();
}

async function findCalendarConflict(dateKey, scopeType, scopeId, excludedId) {
  const filter = {
    dateKey,
    scopeType,
    scopeId: scopeId || null,
    status: hrEmployeeStatuses.ACTIVE,
  };
  if (excludedId) filter._id = { $ne: excludedId };
  return models().CalendarOverride.findOne(filter).lean();
}

async function updateCalendarOverrideById(id, patch) {
  return updateRecord(models().CalendarOverride, id, patch);
}

async function findEffectiveAssignment(profileId, workDateKey) {
  return models().ShiftAssignment.findOne({
    profileId,
    status: hrEmployeeStatuses.ACTIVE,
    effectiveFrom: { $lte: workDateKey },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: workDateKey } }],
  }).sort({ effectiveFrom: -1, _id: -1 }).lean();
}

async function findCalendarOverrides(dateKey, context) {
  return models().CalendarOverride.find({
    dateKey,
    status: hrEmployeeStatuses.ACTIVE,
    $or: [
      { scopeType: 'GLOBAL', scopeId: null },
      { scopeType: 'WORK_LOCATION', scopeId: context.workLocationId },
      { scopeType: 'DEPARTMENT', scopeId: context.departmentId },
      { scopeType: 'TEAM', scopeId: context.teamId },
      { scopeType: 'PROFILE', scopeId: context.profileId },
    ],
  }).lean();
}

module.exports = {
  createAssignment,
  createCalendarOverride,
  createShift,
  createWorkLocation,
  findAssignmentById,
  findAssignmentOverlaps,
  findCalendarOverrides,
  findCalendarConflict,
  findEffectiveAssignment,
  findCalendarOverrideById,
  findShiftById,
  findShiftsByIds,
  findWorkLocationById,
  findWorkLocationsByIds,
  listAssignments,
  listCalendarOverrides,
  listShifts,
  listWorkLocations,
  updateAssignmentById,
  updateCalendarOverrideById,
  updateShiftById,
  updateWorkLocationById,
};
