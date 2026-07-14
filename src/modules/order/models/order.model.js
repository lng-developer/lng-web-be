const mongoose = require('mongoose');

const { salesChannelCodes, externalOrderSources } = require('../constants/externalOrderSources');
const {
  addressValidationStatuses,
  caseStatuses,
  costCenterStatuses,
  orderStatuses,
  paymentStatuses,
  psdStatuses,
} = require('../constants/orderStatuses');

const orderSchema = new mongoose.Schema(
  {
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
    externalStatus: {
      type: String,
      trim: true,
      default: null,
    },
    externalAccountId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    assignedStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
      index: true,
    },
    costCenterStatus: {
      type: String,
      enum: Object.values(costCenterStatuses),
      default: costCenterStatuses.MISSING,
      index: true,
    },
    psdStatus: {
      type: String,
      enum: Object.values(psdStatuses),
      default: psdStatuses.MISSING,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: Object.values(paymentStatuses),
      default: paymentStatuses.UNKNOWN,
      index: true,
    },
    caseStatus: {
      type: String,
      enum: Object.values(caseStatuses),
      default: caseStatuses.NONE,
      index: true,
    },
    importSources: {
      type: [{
        type: String,
        enum: Object.values(externalOrderSources),
      }],
      default: [],
    },
    orderedAt: {
      type: Date,
      default: null,
      index: true,
    },
    shipByDate: {
      type: Date,
      default: null,
      index: true,
    },
    deliveredByDate: {
      type: Date,
      default: null,
    },
    deliveredAt: {
      type: Date,
      default: null,
      index: true,
    },
    buyer: {
      name: {
        type: String,
        trim: true,
        default: null,
      },
      emailMasked: {
        type: String,
        trim: true,
        default: null,
      },
      phoneMasked: {
        type: String,
        trim: true,
        default: null,
      },
      externalBuyerId: {
        type: String,
        trim: true,
        default: null,
      },
    },
    shippingAddress: {
      name: {
        type: String,
        trim: true,
        default: null,
      },
      company: {
        type: String,
        trim: true,
        default: null,
      },
      addressLine1: {
        type: String,
        trim: true,
        default: null,
      },
      addressLine2: {
        type: String,
        trim: true,
        default: null,
      },
      addressLine3: {
        type: String,
        trim: true,
        default: null,
      },
      addressType: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
      },
      city: {
        type: String,
        trim: true,
        default: null,
      },
      stateOrProvince: {
        type: String,
        trim: true,
        default: null,
      },
      stateOrProvinceCode: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
      },
      postalCode: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
      },
      country: {
        type: String,
        trim: true,
        default: null,
      },
      countryCode: {
        type: String,
        trim: true,
        uppercase: true,
        minlength: 2,
        maxlength: 2,
        default: null,
      },
      phoneMasked: {
        type: String,
        trim: true,
        default: null,
      },
    },
    addressValidationStatus: {
      type: String,
      enum: Object.values(addressValidationStatuses),
      default: addressValidationStatuses.NOT_CHECKED,
      index: true,
    },
    shippingService: {
      level: {
        type: String,
        trim: true,
        default: null,
      },
      name: {
        type: String,
        trim: true,
        default: null,
      },
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
    },
    replacementReason: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(orderStatuses),
      default: orderStatuses.IMPORTED,
      required: true,
      index: true,
    },
    rawRecordIds: {
      type: [mongoose.Schema.Types.ObjectId],
      default: [],
      index: true,
    },
    // externalData is for small platform-specific snapshots only.
    // Business logic must not depend on fields inside externalData.
    // Raw source payloads belong to integration/externalOrderImport.
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

orderSchema.index({ salesChannelCode: 1, marketplaceCode: 1, externalOrderId: 1 }, { unique: true });
orderSchema.index({ orderedAt: -1, _id: -1 });
orderSchema.index({ shopId: 1, status: 1, shipByDate: 1 });
orderSchema.index({ shopId: 1, orderedAt: -1 });
orderSchema.index({ shopId: 1, costCenterStatus: 1, orderedAt: -1 });
orderSchema.index({ shopId: 1, psdStatus: 1, orderedAt: -1 });
orderSchema.index({ shopId: 1, paymentStatus: 1, orderedAt: -1 });
orderSchema.index({ shopId: 1, caseStatus: 1, orderedAt: -1 });
orderSchema.index({ shopConnectionId: 1, orderedAt: -1 });
orderSchema.index({ salesChannelCode: 1, marketplaceCode: 1, externalStatus: 1 });
orderSchema.index({ shopId: 1, 'shippingAddress.countryCode': 1, orderedAt: -1 });
orderSchema.index({ shopId: 1, 'shippingAddress.stateOrProvinceCode': 1, orderedAt: -1 });
orderSchema.index({ 'shippingAddress.postalCode': 1 });

module.exports = mongoose.model('Order', orderSchema);
