const mongoose = require('mongoose');
const { recordStatuses } = require('../constants/catalog.constants');
const { printMethodValues } = require('../../../shared/constants/printMethods');

const productTypeGroupSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: 'sortOrder must be an integer',
      },
    },
    printMethod: {
      type: String,
      enum: printMethodValues,
      uppercase: true,
      trim: true,
      default: null,
      index: true,
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

productTypeGroupSchema.index({ sortOrder: 1, name: 1 });

module.exports = mongoose.model('ProductTypeGroup', productTypeGroupSchema);
