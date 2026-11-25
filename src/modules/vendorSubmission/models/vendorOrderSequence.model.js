const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  sequence: { type: Number, required: true, min: 0 },
}, { versionKey: false });

module.exports = mongoose.model('VendorOrderSequence', schema);
