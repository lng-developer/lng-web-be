const ListingLaunch = require('../models/listingLaunch.model');
const { states } = require('../constants/listingLaunch.constants');
const { normalizePagination, getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');

async function create(payload) {
  return (await ListingLaunch.create(payload)).toObject();
}

function findById(id, session = null) {
  return ListingLaunch.findById(id).session(session).lean();
}

async function list({ shopIds, shopId, state, ...query } = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = {};
  if (shopIds) filter.shopId = { $in: shopIds };
  if (shopId) {
    filter.shopId = shopIds ? { $in: shopIds, $eq: shopId } : shopId;
  }
  if (state) filter.state = state;
  const [items, total] = await Promise.all([
    ListingLaunch.find(filter).sort({ updatedAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit })).limit(limit).lean(),
    ListingLaunch.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

function update(id, patch, { invalidateContent = false } = {}) {
  const updateDocument = { $set: { ...patch } };
  if (invalidateContent) {
    updateDocument.$set.approvedContent = null;
    updateDocument.$inc = { contentInputVersion: 1 };
  }
  return ListingLaunch.findByIdAndUpdate(id, updateDocument, { returnDocument: 'after', runValidators: true }).lean();
}

function selectProduct(id, selection) {
  return ListingLaunch.findOneAndUpdate(
    { _id: id, state: states.BRIEF },
    {
      $set: { ...selection, state: states.PRODUCT_SELECTED, approvedContent: null },
      $inc: { contentInputVersion: 1 },
    },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

function saveContentInputs(id, expectedInputVersion, contentInputs) {
  const versionFilter = expectedInputVersion === 0
    ? { $or: [{ contentInputVersion: 0 }, { contentInputVersion: { $exists: false } }] }
    : { contentInputVersion: expectedInputVersion };
  return ListingLaunch.findOneAndUpdate(
    { _id: id, state: states.PRODUCT_SELECTED, ...versionFilter },
    {
      $set: { contentInputs, approvedContent: null },
      $inc: { contentInputVersion: 1 },
    },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

function reserveContentGeneration(id, expectedInputVersion, snapshot, session) {
  const versionFilter = expectedInputVersion === 0
    ? { $or: [{ contentInputVersion: 0 }, { contentInputVersion: { $exists: false } }] }
    : { contentInputVersion: expectedInputVersion };
  return ListingLaunch.findOneAndUpdate(
    { _id: id, state: states.PRODUCT_SELECTED, productTypeGroupId: snapshot.productTypeGroupId,
      internalTemplateId: snapshot.internalTemplateId, ...versionFilter },
    { $set: { contentInputVersion: expectedInputVersion }, $inc: { contentVersionCounter: 0 }, $currentDate: { updatedAt: true } },
    { session, timestamps: false, returnDocument: 'after', runValidators: true },
  ).lean();
}

function allocateContentVersion(id, session) {
  return ListingLaunch.findByIdAndUpdate(id, { $inc: { contentVersionCounter: 1 } },
    { session, returnDocument: 'after', runValidators: true }).lean();
}

function approveContent(id, expectedInputVersion, approval, session) {
  return ListingLaunch.findOneAndUpdate({ _id: id, state: states.PRODUCT_SELECTED, contentInputVersion: expectedInputVersion },
    { $set: { approvedContent: approval } }, { session, returnDocument: 'after', runValidators: true }).lean();
}

function replaceMockup(id, { expectedMockupRevision, expectedInputVersion, assetId }) {
  const version = (field, expected) => expected === 0
    ? { $or: [{ [field]: 0 }, { [field]: { $exists: false } }] } : { [field]: expected };
  return ListingLaunch.findOneAndUpdate({ _id: id, state: states.PRODUCT_SELECTED,
    $and: [version('mockupRevision', expectedMockupRevision), version('contentInputVersion', expectedInputVersion)] },
  { $set: { mockupAssetId: assetId, latestMockupAnalysisRunId: null, approvedContent: null },
    $unset: { 'contentInputs.designContext': 1 }, $inc: { mockupRevision: 1, contentInputVersion: 1 } },
  { returnDocument: 'after', runValidators: true }).lean();
}
module.exports = { create, findById, list, update, selectProduct, saveContentInputs, reserveContentGeneration, allocateContentVersion, approveContent, replaceMockup };
