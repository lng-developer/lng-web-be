const mongoose = require('mongoose');

const { salesChannelCodes, externalOrderSources } = require('../constants/externalOrderSources');
const { orderItemStatuses } = require('../constants/orderStatuses');

const integerValidator = {
  validator: Number.isInteger,
  message: '{PATH} must be an integer',
};

function moneyAmountField() {
  return {
    type: Number,
    default: 0,
    validate: integerValidator,
  };
}

const orderItemSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: true,
      index: true,
    },
    shopConnectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ShopConnection',
      default: null,
      index: true,
    },
    salesChannelCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      enum: Object.values(salesChannelCodes),
      default: salesChannelCodes.AMAZON,
      index: true,
    },
    marketplaceCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    externalOrderId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    externalItemId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    externalAccountId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    externalProductId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    externalListingId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    externalVariantId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    asin: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    sku: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    title: {
      type: String,
      trim: true,
      default: null,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
      validate: integerValidator,
    },
    variantRaw: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    customizationRawSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    price: {
      // All monetary amount fields are stored in minor units, e.g. USD cents. Do not store floating-point money values.
      itemPriceAmount: moneyAmountField(),
      itemTaxAmount: moneyAmountField(),
      shippingPriceAmount: moneyAmountField(),
      shippingTaxAmount: moneyAmountField(),
      giftWrapPriceAmount: moneyAmountField(),
      giftWrapTaxAmount: moneyAmountField(),
      itemPromotionDiscountAmount: moneyAmountField(),
      shipPromotionDiscountAmount: moneyAmountField(),
      currency: {
        type: String,
        uppercase: true,
        trim: true,
        minlength: 3,
        maxlength: 3,
        default: 'USD',
      },
    },
    listingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      default: null,
      index: true,
    },
    replacementOfOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
      index: true,
    },
    replacementOfOrderItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OrderItem',
      default: null,
      index: true,
    },
    replacementSequence: {
      type: Number,
      default: null,
      min: 1,
      validate: {
        validator(value) {
          return value === null || value === undefined || Number.isInteger(value);
        },
        message: '{PATH} must be an integer',
      },
    },
    replacementReason: {
      type: String,
      trim: true,
      default: null,
    },
    externalStatus: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(orderItemStatuses),
      default: orderItemStatuses.NEW,
      required: true,
      index: true,
    },
    shipByDate: {
      type: Date,
      default: null,
      index: true,
    },
    rawRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    rawRecordIds: {
      type: [mongoose.Schema.Types.ObjectId],
      default: [],
      index: true,
    },
    importSources: {
      type: [{
        type: String,
        enum: Object.values(externalOrderSources),
      }],
      default: [],
    },
    // externalData is for small platform-specific snapshots only. Business logic must not depend on fields inside externalData. Raw source payloads belong to integration/externalOrderImport.
    externalData: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    importedAt: {
      type: Date,
      default: null,
    },
    lastImportedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

orderItemSchema.index({ orderId: 1, externalItemId: 1 }, { unique: true });
orderItemSchema.index({ orderId: 1, createdAt: 1, _id: 1 });
orderItemSchema.index({ shopId: 1, createdAt: -1, _id: -1 });
orderItemSchema.index({ shopId: 1, status: 1, shipByDate: 1 });
orderItemSchema.index({ salesChannelCode: 1, marketplaceCode: 1, externalOrderId: 1 });
orderItemSchema.index({ externalAccountId: 1, createdAt: -1 });
orderItemSchema.index({ asin: 1, sku: 1 });

module.exports = mongoose.model('OrderItem', orderItemSchema);
