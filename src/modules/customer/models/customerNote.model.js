const mongoose = require('mongoose');

const customerNoteTypes = ['GENERAL', 'CARE', 'ISSUE', 'REFUND', 'ADDRESS', 'VIP'];

const customerNoteSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true,
  },
  body: { type: String, required: true, trim: true },
  type: { type: String, enum: customerNoteTypes, default: 'GENERAL', index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { timestamps: true });

customerNoteSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.model('CustomerNote', customerNoteSchema);
module.exports.customerNoteTypes = customerNoteTypes;
