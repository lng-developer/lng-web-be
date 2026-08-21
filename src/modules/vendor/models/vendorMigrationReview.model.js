const mongoose = require('mongoose');

const vendorMigrationReviewSchema = new mongoose.Schema({
  legacyProductId: { type: String, required: true, unique: true, trim: true },
  legacyVendorId: { type: String, default: null, trim: true },
  vendorCode: { type: String, default: null, trim: true, uppercase: true },
  vendorName: { type: String, default: null, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  externalProductId: { type: String, default: null, trim: true },
  variantCount: { type: Number, required: true, min: 0, default: 0 },
  productTypeGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductTypeGroup', default: null },
  status: { type: String, enum: ['PENDING', 'ASSIGNED'], default: 'PENDING', index: true },
  source: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });

vendorMigrationReviewSchema.index({ status: 1, vendorCode: 1, code: 1 });

module.exports = mongoose.model('VendorMigrationReview', vendorMigrationReviewSchema);
