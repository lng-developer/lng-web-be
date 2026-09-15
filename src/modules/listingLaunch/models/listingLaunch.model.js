const mongoose = require('mongoose');
const { states, salesChannelCode } = require('../constants/listingLaunch.constants');

const { ObjectId } = mongoose.Schema.Types;
const productFactsSchema = new mongoose.Schema({
  brand: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
  productName: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
  material: { type: String, required: true, trim: true, minlength: 1, maxlength: 500 },
  features: {
    type: [{ type: String, required: true, trim: true, minlength: 1, maxlength: 300 }],
    required: true,
    validate: (features) => features.length >= 1 && features.length <= 10,
  },
  personalization: { type: String, trim: true, maxlength: 1000, default: null },
  careInstructions: { type: String, trim: true, maxlength: 1000, default: null },
}, { _id: false, strict: 'throw' });
const availableColorSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, uppercase: true, minlength: 1, maxlength: 60, match: /^[A-Z0-9_-]+$/ },
  label: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
}, { _id: false, strict: 'throw' });
const contentInputsSchema = new mongoose.Schema({
  profileCode: { type: String, required: true, enum: ['AMAZON_US_APPAREL_CONTENT_V1'] },
  keyword: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
  language: { type: String, required: true, enum: ['en-US'] },
  productFacts: { type: productFactsSchema, required: true },
  availableColors: {
    type: [availableColorSchema],
    required: true,
    validate: (colors) => colors.length >= 1
      && colors.length <= 30
      && new Set(colors.map(({ code }) => code)).size === colors.length,
  },
  factsConfirmed: { type: Boolean, required: true, enum: [true] },
  confirmedBy: { type: ObjectId, required: true },
  confirmedAt: { type: Date, required: true },
}, { _id: false, strict: 'throw' });
const approvedContentSchema = new mongoose.Schema({
  versionId: { type: ObjectId, required: true },
  inputVersion: { type: Number, required: true, min: 0, validate: Number.isInteger },
  inputHash: { type: String, required: true, match: /^[a-f\d]{64}$/ },
  selectedColorCodes: {
    type: [{ type: String, required: true, trim: true, uppercase: true, match: /^[A-Z0-9_-]+$/ }],
    required: true,
    validate: (codes) => codes.length >= 1 && codes.length <= 3 && new Set(codes).size === codes.length,
  },
  approvedBy: { type: ObjectId, required: true },
  approvedAt: { type: Date, required: true },
}, { _id: false, strict: 'throw' });
const schema = new mongoose.Schema({
  shopId: { type: ObjectId, required: true, immutable: true },
  salesChannelCode: { type: String, required: true, enum: [salesChannelCode], immutable: true },
  marketplaceCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 80, immutable: true },
  brief: { type: String, required: true, trim: true, maxlength: 5000 },
  workingTitle: { type: String, trim: true, maxlength: 500, default: null },
  productTypeGroupId: { type: ObjectId, default: null },
  internalTemplateId: { type: ObjectId, default: null },
  referenceAssetIds: { type: [ObjectId], default: [], validate: (ids) => ids.length <= 50 && new Set(ids.map(String)).size === ids.length },
  state: { type: String, enum: Object.values(states), default: states.BRIEF, required: true },
  selectedBy: { type: ObjectId, default: null },
  selectedAt: { type: Date, default: null },
  contentInputs: { type: contentInputsSchema, default: null },
  contentInputVersion: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  contentVersionCounter: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  approvedContent: { type: approvedContentSchema, default: null },
  createdBy: { type: ObjectId, default: null, immutable: true },
}, { timestamps: true });

schema.index({ shopId: 1, state: 1, updatedAt: -1, _id: -1 });
schema.index({ shopId: 1, updatedAt: -1, _id: -1 });

module.exports = mongoose.model('ListingLaunch', schema);
