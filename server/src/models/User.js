const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');

const userSchema = new mongoose.Schema({
  email:            { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash:     { type: String, select: false }, // optional for OTP-only users
  name:             { type: String, required: true, trim: true },
  role:             { type: String, enum: ['super_admin','admin','user','viewer'], default: 'user' },
  mobile:           { type: String, trim: true, sparse: true },
  firebaseUid:      { type: String, sparse: true }, // Firebase UID for phone auth linking
  authMethods:      [{ type: String, enum: ['password','otp'] }], // which login methods this user has
  otpLoginsToday:   { type: Number, default: 0 },
  lastOtpLoginDate: { type: String },    // YYYY-MM-DD
  isActive:         { type: Boolean, default: true },
  lastLoginAt:      { type: Date },
  deletedAt:        { type: Date, default: null }
}, { timestamps: true });

userSchema.index({ email: 1 });
userSchema.index({ mobile: 1 }, { sparse: true });   // fast OTP lookup
userSchema.index({ firebaseUid: 1 }, { sparse: true });
userSchema.index({ deletedAt: 1 });

userSchema.methods.checkPassword = async function(plain) {
  if (!this.passwordHash) return false; // OTP-only user has no password
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.statics.hashPassword = async function(plain) {
  return bcrypt.hash(plain, 12);
};

// Generate placeholder email for mobile-first OTP users
userSchema.statics.mobileEmail = function(phone) {
  const cleaned = phone.replace(/[^0-9]/g, '');
  return `mobile_${cleaned}@otp.leadflow.app`;
};

// Never return passwordHash in JSON
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
