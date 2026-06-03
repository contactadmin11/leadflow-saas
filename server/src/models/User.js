const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  name:         { type: String, required: true, trim: true },
  role:         { type: String, enum: ['super_admin','admin','user','viewer'], default: 'user' },
  mobile:       { type: String, trim: true },
  otpLoginsToday: { type: Number, default: 0 },
  lastOtpLoginDate: { type: String }, // Stored as YYYY-MM-DD
  isActive:     { type: Boolean, default: true },
  lastLoginAt:  { type: Date },
  deletedAt:    { type: Date, default: null }
}, { timestamps: true });

userSchema.index({ email: 1 });
userSchema.index({ deletedAt: 1 });

userSchema.methods.checkPassword = async function(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.statics.hashPassword = async function(plain) {
  return bcrypt.hash(plain, 12);
};

// Never return passwordHash in JSON
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
