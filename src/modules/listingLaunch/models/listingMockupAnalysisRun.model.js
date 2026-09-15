const mongoose = require('mongoose');
const ContentRun = require('./listingContentRun.model');
const { ObjectId } = mongoose.Schema.Types;
const id = () => ({ type: ObjectId, required: true, immutable: true });
const hash = () => ({ type: String, required: true, immutable: true, match: /^[a-f\d]{64}$/ });
const text = (max) => ({ type: String, default: '', validate: value => [...value].length <= max });
const schema = new mongoose.Schema({
  launchId: id(), shopId: id(), assetId: id(), requestedBy: id(),
  requestKey: { type: String, required: true, immutable: true, match: /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/ },
  requestHash: hash(), assetHash: hash(),
  mockupRevision: { type: Number, required: true, immutable: true, min: 1, validate: Number.isInteger },
  model: { type: String, required: true, immutable: true, maxlength: 200 },
  provider: { type: String, required: true, immutable: true, enum: ['OPENAI'] },
  promptVersion: { type: Number, required: true, immutable: true, enum: [1] },
  status: { type: String, enum: ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'], default: 'QUEUED' },
  result: { type: new mongoose.Schema({ detectedText: text(2000), theme: text(300), designDescription: text(2000), suggestedKeyword: text(200),
    warnings: { type: [{ type: String, enum: ['UNREADABLE_TEXT', 'LOW_DETAIL', 'AMBIGUOUS_DESIGN', 'NO_CLEAR_DESIGN'] }], validate: v => v.length <= 10 },
  }, { _id: false, strict: 'throw' }), default: null },
  startedAt: { type: Date, default: null }, finishedAt: { type: Date, default: null }, leaseExpiresAt: { type: Date, default: null },
  errorCode: { type: String, maxlength: 80, default: null }, errorMessage: { type: String, maxlength: 300, default: null },
  validationErrors: { type: [ContentRun.schema.path('validationErrors').schema.clone()], default: [], validate: v => v.length <= 20 },
  usage: { type: ContentRun.schema.path('usage').schema.clone(), default: null },
  providerRequestId: { type: String, maxlength: 200, default: null },
}, { strict: 'throw', timestamps: true });
schema.index({ launchId: 1, requestKey: 1 }, { unique: true });
schema.index({ launchId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['QUEUED', 'RUNNING'] } } });
schema.index({ status: 1, createdAt: 1, _id: 1 });
schema.index({ launchId: 1, createdAt: -1, _id: -1 });
module.exports = mongoose.model('ListingMockupAnalysisRun', schema);
