const mongoose = require('mongoose');

const shopStatuses = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
});

const shopSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
    },
    status: {
      type: String,
      enum: Object.values(shopStatuses),
      default: shopStatuses.ACTIVE,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

shopSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Shop', shopSchema);
module.exports.shopStatuses = shopStatuses;
