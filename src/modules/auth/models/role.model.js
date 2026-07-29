const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      uppercase: true,
    },
    description: {
      type: String,
      trim: true,
      default: null,
      maxlength: 240,
    },
    permissions: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Permission',
    }],
    mutationVersion: { type: Number, default: 0, select: false },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('Role', roleSchema);
