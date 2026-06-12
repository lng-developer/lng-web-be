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
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('Permission', permissionSchema);
