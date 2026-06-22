const mongoose = require('mongoose');

const permissionSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      trim: true,
      default: null,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      default: null,
      maxlength: 240,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('Permission', permissionSchema);
