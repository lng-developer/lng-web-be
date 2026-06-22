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
    phone: {
      type: String,
      trim: true,
      default: null,
      maxlength: 40,
    },
    avatarUrl: {
      type: String,
      trim: true,
      default: null,
      maxlength: 500,
    },
    personalEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      maxlength: 160,
    },
    dateOfBirth: {
      type: Date,
      default: null,
    },
    gender: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      maxlength: 40,
    },
    address: {
      type: String,
      trim: true,
      default: null,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  },
);

userProfileSchema.index({ employeeCode: 1, fullName: 1 });

module.exports = mongoose.model('UserProfile', userProfileSchema);
