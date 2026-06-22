const mongoose = require('mongoose');

const userProfileSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      unique: true,
      index: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    employeeCode: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      trim: true,
      uppercase: true,
    },
  },
  {
    timestamps: true,
  },
);

userProfileSchema.index({ employeeCode: 1, fullName: 1 });

module.exports = mongoose.model('UserProfile', userProfileSchema);
