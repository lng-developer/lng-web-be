const mongoose = require('mongoose');
const {
  artworkOutputRoles,
  artworkSlotTypes,
  designAssetTypes,
  internalTemplateFieldSources,
  internalTemplateFieldTypes,
  recordStatuses,
} = require('../constants/catalog.constants');

const safeIdentifierPattern = /^[A-Za-z][A-Za-z0-9_]*$/;

const requiredFieldSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      match: safeIdentifierPattern,
    },
    label: {
      type: String,
      trim: true,
      default: null,
    },
    type: {
      type: String,
      enum: Object.values(internalTemplateFieldTypes),
      default: internalTemplateFieldTypes.UNKNOWN,
    },
    required: {
      type: Boolean,
      default: false,
    },
    source: {
      type: String,
      enum: Object.values(internalTemplateFieldSources),
      default: null,
    },
    validation: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    sortOrder: {
      type: Number,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: 'sortOrder must be an integer',
      },
    },
  },
  { _id: false },
);

const artworkSlotSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      match: safeIdentifierPattern,
    },
    label: {
      type: String,
      trim: true,
      default: null,
    },
    type: {
      type: String,
      enum: Object.values(artworkSlotTypes),
      default: artworkSlotTypes.MIXED,
    },
    required: {
      type: Boolean,
      default: false,
    },
    acceptedFieldKeys: {
      type: [String],
      default: [],
    },
    outputRole: {
      type: String,
      enum: Object.values(artworkOutputRoles),
      default: null,
    },
    sortOrder: {
      type: Number,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: 'sortOrder must be an integer',
      },
    },
  },
  { _id: false },
);

const designAssetSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: Object.values(designAssetTypes),
      required: true,
    },
    mediaAssetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MediaAsset',
      required: true,
    },
    version: {
      type: String,
      trim: true,
      default: 'v1',
    },
    label: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(recordStatuses),
      default: recordStatuses.ACTIVE,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { _id: false },
);

const internalTemplateSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      immutable: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    productTypeGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductTypeGroup',
      required: true,
      index: true,
    },
    requiredFields: {
      type: [requiredFieldSchema],
      default: [],
    },
    artworkSlots: {
      type: [artworkSlotSchema],
      default: [],
    },
    designAssets: {
      type: [designAssetSchema],
      default: [],
    },
    status: {
      type: String,
      enum: Object.values(recordStatuses),
      default: recordStatuses.ACTIVE,
      index: true,
    },
  },
  { timestamps: true },
);

internalTemplateSchema.index({ code: 1 }, { unique: true });
internalTemplateSchema.index({ productTypeGroupId: 1, status: 1 });
internalTemplateSchema.index({ 'designAssets.mediaAssetId': 1 });

module.exports = mongoose.model('InternalTemplate', internalTemplateSchema);
