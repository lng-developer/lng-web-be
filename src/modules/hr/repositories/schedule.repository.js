const { hrEmployeeStatuses } = require('../constants/hr.constants');
const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const { buildCaseInsensitivePrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const CalendarOverride = require('../models/calendarOverride.model');
const Shift = require('../models/shift.model');
const ShiftAssignment = require('../models/shiftAssignment.model');
const WorkLocation = require('../models/workLocation.model');

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

async function createRecord(Model, payload, { session } = {}) {
  const [record] = await Model.create([payload], session ? { session } : undefined);
  return record.toObject();
}

async function updateRecord(Model, id, patch, { session } = {}) {
  return Model.findByIdAndUpdate(
    id,
    { $set: patch },
    { returnDocument: 'after', runValidators: true, ...(session ? { session } : {}) },
  ).lean();
}

async function listWorkLocations(query) {
  return listRecords(WorkLocation, query);
}

async function createWorkLocation(payload) {
  return createRecord(WorkLocation, payload);
}

async function findWorkLocationById(id) {
  return WorkLocation.findById(id).lean();
}

async function findWorkLocationsByIds(ids = []) {
  const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
  if (!uniqueIds.length) return [];
  return WorkLocation.find({ _id: { $in: uniqueIds } }).lean();
}

async function updateWorkLocationById(id, patch) {
  return updateRecord(WorkLocation, id, patch);
}

async function listShifts(query) {
  return listRecords(Shift, query);
}

async function createShift(payload) {
  return createRecord(Shift, payload);
}

async function findShiftById(id) {
  return Shift.findById(id).lean();
}

async function findShiftsByIds(ids = []) {
  const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
  if (!uniqueIds.length) return [];
  return Shift.find({ _id: { $in: uniqueIds } }).lean();
}

async function updateShiftById(id, patch) {
  return updateRecord(Shift, id, patch);
}

async function listAssignments(query = {}) {
  const { page, limit } = normalizePagination(query);
  const statuses = [hrEmployeeStatuses.ACTIVE, hrEmployeeStatuses.SUSPENDED];
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
  if (query.effectiveTo) filter.effectiveFrom = { $lte: query.effectiveTo };
  if (query.effectiveFrom) {
    filter.$or = [{ effectiveTo: null }, { effectiveTo: { $gte: query.effectiveFrom } }];
  }
  const [items, total, ...statusTotals] = await Promise.all([
    ShiftAssignment.find(filter)
      .sort({ effectiveFrom: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    ShiftAssignment.countDocuments(filter),
    ...statuses.map((status) => ShiftAssignment.countDocuments({ $and: [filter, { status }] })),
  ]);
  return {
    items,
    pagination: { page, limit, total },
    summary: {
      total,
      statusCounts: Object.fromEntries(statuses.map((status, index) => [status, statusTotals[index]])),
    },
  };
}

async function createAssignment(payload, options) {
  return createRecord(ShiftAssignment, payload, options);
}

async function findAssignmentById(id) {
  return ShiftAssignment.findById(id).lean();
}

async function updateAssignmentById(id, patch, options) {
  return updateRecord(ShiftAssignment, id, patch, options);
}

async function findAssignmentOverlaps(profileId, effectiveFrom, effectiveTo, excludedId, { session } = {}) {
  const filter = {
    profileId,
    status: hrEmployeeStatuses.ACTIVE,
    effectiveFrom: { $lte: effectiveTo || '9999-12-31' },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: effectiveFrom } }],
  };
  if (excludedId) filter._id = { $ne: excludedId };
  const query = ShiftAssignment.find(filter);
  return (session ? query.session(session) : query).lean();
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
    CalendarOverride.find(filter)
      .sort({ dateKey: -1, scopeType: 1, _id: 1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    CalendarOverride.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total } };
}

async function createCalendarOverride(payload) {
  return createRecord(CalendarOverride, payload);
}

async function findCalendarOverrideById(id) {
  return CalendarOverride.findById(id).lean();
}

async function findCalendarConflict(dateKey, scopeType, scopeId, excludedId) {
  const filter = {
    dateKey,
    scopeType,
    scopeId: scopeId || null,
    status: hrEmployeeStatuses.ACTIVE,
  };
  if (excludedId) filter._id = { $ne: excludedId };
  return CalendarOverride.findOne(filter).lean();
}

async function updateCalendarOverrideById(id, patch) {
  return updateRecord(CalendarOverride, id, patch);
}

async function findEffectiveAssignment(profileId, workDateKey) {
  return ShiftAssignment.findOne({
    profileId,
    status: hrEmployeeStatuses.ACTIVE,
    effectiveFrom: { $lte: workDateKey },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: workDateKey } }],
  }).sort({ effectiveFrom: -1, _id: -1 }).lean();
}

async function listAssignmentsEffectiveForProfiles(profileIds = [], dateFrom, dateTo, { shiftId } = {}) {
  const ids = [...new Set(profileIds.filter(Boolean).map(String))];
  if (!ids.length) return [];
  return ShiftAssignment.find({
    profileId: { $in: ids },
    status: hrEmployeeStatuses.ACTIVE,
    effectiveFrom: { $lte: dateTo },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: dateFrom } }],
    ...(shiftId ? { shiftId } : {}),
  }).sort({ effectiveFrom: -1, _id: -1 }).lean();
}

async function findCalendarOverrides(dateKey, context) {
  return CalendarOverride.find({
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
  listAssignmentsEffectiveForProfiles,
  listCalendarOverrides,
  listShifts,
  listWorkLocations,
  updateAssignmentById,
  updateCalendarOverrideById,
  updateShiftById,
  updateWorkLocationById,
};
