const mongoose = require('mongoose');
const ListingLaunch = require('./listingLaunch.model');
const immutableFields = require('./immutableFields');
const { runStatuses, activeRunStatuses } = require('../constants/listingContent.constants');
const { listingContentProfile } = require('../constants/listingContentProfile');

const { ObjectId } = mongoose.Schema.Types;
const strictOptions = { _id: false, strict: 'throw' };
const launchInputs = ListingLaunch.schema.path('contentInputs').schema;
const metadataSchema = new mongoose.Schema({
  code: { type: String, required: true, maxlength: 100 },
  name: { type: String, required: true, maxlength: 500 },
}, strictOptions);
const groupMetadataSchema = metadataSchema.clone();
groupMetadataSchema.add({ printMethod: { type: String, maxlength: 100, default: null } });
const snapshotSchema = new mongoose.Schema({
  profileCode: { type: String, enum: [listingContentProfile.code], required: true },
  profileVersion: { type: Number, required: true, min: 1, validate: Number.isInteger },
  marketplaceCode: { type: String, enum: [listingContentProfile.marketplaceCode], required: true },
  brief: { type: String, required: true, maxlength: 5000 },
  productTypeGroupId: { type: String, required: true, match: /^[a-f\d]{24}$/ },
  internalTemplateId: { type: String, required: true, match: /^[a-f\d]{24}$/ },
  keyword: { type: String, required: true, maxlength: 200 },
  language: { type: String, required: true, enum: [listingContentProfile.language] },
  productFacts: { type: launchInputs.path('productFacts').schema.clone(), required: true },
  availableColors: {
    type: [launchInputs.path('availableColors').schema.clone()], required: true,
    validate: (colors) => colors.length >= 1 && colors.length <= 30 && new Set(colors.map(({ code }) => code)).size === colors.length,
  },
  catalog: { type: new mongoose.Schema({
    productTypeGroup: { type: groupMetadataSchema, required: true },
    internalTemplate: { type: metadataSchema, required: true },
  }, strictOptions), required: true },
}, strictOptions);
const validationErrorSchema = new mongoose.Schema({
  field: { type: String, required: true, maxlength: 200 },
  code: { type: String, required: true, maxlength: 80 },
  message: { type: String, required: true, maxlength: 300 },
}, strictOptions);
const usageSchema = new mongoose.Schema({
  inputTokens: { type: Number, min: 0, validate: Number.isInteger, default: null },
  outputTokens: { type: Number, min: 0, validate: Number.isInteger, default: null },
  totalTokens: { type: Number, min: 0, validate: Number.isInteger, default: null },
}, strictOptions);
const schema = new mongoose.Schema({
  launchId: { type: ObjectId, required: true, immutable: true },
  shopId: { type: ObjectId, required: true, immutable: true },
  requestKey: { type: String, required: true, immutable: true, match: /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/ },
  requestHash: { type: String, required: true, immutable: true, match: /^[a-f\d]{64}$/ },
  inputVersion: { type: Number, required: true, immutable: true, min: 0, validate: Number.isInteger },
  inputHash: { type: String, required: true, immutable: true, match: /^[a-f\d]{64}$/ },
  inputSnapshot: { type: immutableFields(snapshotSchema), required: true, immutable: true },
  profileVersion: { type: Number, required: true, immutable: true, min: 1, validate: Number.isInteger },
  promptVersion: { type: Number, required: true, immutable: true, min: 1, validate: Number.isInteger },
  provider: { type: String, required: true, immutable: true, enum: ['OPENAI'] },
  model: { type: String, required: true, immutable: true, maxlength: 200 },
  status: { type: String, required: true, enum: Object.values(runStatuses), default: runStatuses.QUEUED },
  requestedBy: { type: ObjectId, required: true, immutable: true },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
  leaseExpiresAt: { type: Date, default: null },
  resultVersionId: { type: ObjectId, required: true, immutable: true },
  providerRequestId: { type: String, maxlength: 200, default: null },
  usage: { type: usageSchema, default: null },
  errorCode: { type: String, maxlength: 80, default: null },
  errorMessage: { type: String, maxlength: 300, default: null },
  validationErrors: { type: [validationErrorSchema], default: [], validate: (errors) => errors.length <= 20 },
}, { strict: 'throw', timestamps: true });

schema.index({ launchId: 1, requestKey: 1 }, { unique: true });
schema.index({ launchId: 1 }, { unique: true, partialFilterExpression: { status: { $in: activeRunStatuses } } });
schema.index({ launchId: 1, createdAt: -1, _id: -1 });
schema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('ListingContentRun', schema);
