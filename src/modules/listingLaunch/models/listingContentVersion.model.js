const mongoose = require('mongoose');
const immutableFields = require('./immutableFields');
const { listingContentProfile: { limits } } = require('../constants/listingContentProfile');

const { ObjectId } = mongoose.Schema.Types;
const codePoints = (value, max) => typeof value === 'string' && [...value].length >= 1 && [...value].length <= max;
const colorSchema = new mongoose.Schema({
  code: { type: String, required: true, maxlength: 60, match: /^[A-Z0-9_-]+$/ },
  reason: { type: String, required: true, validate: (value) => codePoints(value, limits.recommendedColors.reasonCodePoints) },
}, { _id: false, strict: 'throw' });
const contentSchema = new mongoose.Schema({
  title: { type: String, required: true, validate: (value) => codePoints(value, limits.titleCodePoints) },
  bullets: { type: [String], required: true,
    validate: (values) => values.length === limits.bulletCount && values.every((value) => codePoints(value, limits.bulletCodePoints)) },
  searchTerms: { type: [String], required: true,
    validate: (values) => values.length >= limits.searchTerms.min && values.length <= limits.searchTerms.max
      && values.every((value) => typeof value === 'string' && value.trim().length > 0)
      && new Set(values).size === values.length && Buffer.byteLength(values.join(' '), 'utf8') <= limits.searchTerms.maxUtf8Bytes },
  recommendedColors: { type: [colorSchema], required: true,
    validate: (values) => values.length >= limits.recommendedColors.min && values.length <= limits.recommendedColors.max
      && new Set(values.map(({ code }) => code)).size === values.length },
}, { _id: false, strict: 'throw' });
const schema = new mongoose.Schema({
  launchId: { type: ObjectId, required: true, immutable: true },
  shopId: { type: ObjectId, required: true, immutable: true },
  version: { type: Number, required: true, immutable: true, min: 1, validate: Number.isInteger },
  source: { type: String, required: true, immutable: true, enum: ['AI', 'MANUAL'] },
  runId: { type: ObjectId, default: null, immutable: true, required() { return this.source === 'AI'; },
    validate(value) { return this.source === 'AI' || value == null; } },
  parentVersionId: { type: ObjectId, default: null, immutable: true, required() { return this.source === 'MANUAL'; },
    validate(value) { return this.source === 'MANUAL' || value == null; } },
  inputVersion: { type: Number, required: true, immutable: true, min: 0, validate: Number.isInteger },
  inputHash: { type: String, required: true, immutable: true, match: /^[a-f\d]{64}$/ },
  profileVersion: { type: Number, required: true, immutable: true, min: 1, validate: Number.isInteger },
  content: { type: immutableFields(contentSchema), required: true, immutable: true },
  createdBy: { type: ObjectId, required: true, immutable: true },
}, { strict: 'throw', timestamps: true });

schema.index({ launchId: 1, version: 1 }, { unique: true });
schema.index({ runId: 1 }, { unique: true, partialFilterExpression: { source: 'AI' } });

module.exports = mongoose.model('ListingContentVersion', schema);
