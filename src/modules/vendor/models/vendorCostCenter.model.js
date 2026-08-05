const mongoose = require('mongoose');
const { recordStatuses } = require('../constants/vendor.constants');

function integerMinorUnit(pathName) {
  return {
    type: Number,
    min: 0,
    default: 0,
    validate: {
      validator: Number.isInteger,
      message: `${pathName} must be an integer minor unit value`,
    },
  };
}

function nonNegativeNumber(pathName) {
  return {
    type: Number,
    min: 0,
    default: null,
    validate: {
      validator: (value) => value === null || value === undefined || Number.isFinite(value),
      message: `${pathName} must be a number`,
    },
  };
}

const shippingCostSchema = new mongoose.Schema(
  {
    economyAmount: integerMinorUnit('economyAmount'),
    additionalAmount: integerMinorUnit('additionalAmount'),
  },
  { _id: false },
);

const additionalCostsSchema = new mongoose.Schema(
  {
    embroideryAmount: integerMinorUnit('embroideryAmount'),
    twoSidedPrintAmount: integerMinorUnit('twoSidedPrintAmount'),
    twoPositionPrintAmount: integerMinorUnit('twoPositionPrintAmount'),
  },
  { _id: false },
);

const vendorCostCenterSchema = new mongoose.Schema(
  {
    vendorProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VendorProduct',
      required: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    sku: {
      type: String,
      uppercase: true,
      trim: true,
      default: null,
      index: true,
    },
    lngCode: {
      type: String,
      uppercase: true,
      trim: true,
      default: null,
      index: true,
    },
    vendorSize: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    vendorColor: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    standardSize: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    standardColor: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    attributes: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    weight: nonNegativeNumber('weight'),
    weightUnit: {
      type: String,
      uppercase: true,
      trim: true,
      default: null,
    },
    width: nonNegativeNumber('width'),
    length: nonNegativeNumber('length'),
    height: nonNegativeNumber('height'),
    dimensionUnit: {
      type: String,
      uppercase: true,
      trim: true,
      default: null,
    },
    baseCostAmount: {
      type: Number,
      min: 0,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: 'baseCostAmount must be an integer minor unit value',
      },
    },
    currency: {
      type: String,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
      default: 'USD',
    },
    domesticShipping: {
      type: shippingCostSchema,
      default: () => ({}),
    },
    internationalShipping: {
      type: shippingCostSchema,
      default: () => ({}),
    },
    priorityShipping: {
      type: shippingCostSchema,
      default: () => ({}),
    },
    importTaxAmount: integerMinorUnit('importTaxAmount'),
    additionalCosts: {
      type: additionalCostsSchema,
      default: () => ({}),
    },
    status: {
      type: String,
      enum: Object.values(recordStatuses),
      default: recordStatuses.ACTIVE,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

vendorCostCenterSchema.index({ vendorProductId: 1, code: 1 }, { unique: true });
vendorCostCenterSchema.index({ vendorProductId: 1, status: 1 });
vendorCostCenterSchema.index({ vendorId: 1, status: 1 });
vendorCostCenterSchema.index({ vendorProductId: 1, status: 1, standardSize: 1, standardColor: 1 });

module.exports = mongoose.model('VendorCostCenter', vendorCostCenterSchema);
