const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  userId:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  refreshToken:      { type: String, required: true, unique: true },
  // Device locking
  deviceFingerprint: { type: String, default: null }, // SHA-256 hash of device info
  deviceName:        { type: String, default: 'Unknown Device' }, // "Chrome on Windows"
  deviceInfo:        { type: mongoose.Schema.Types.Mixed }, // full browser info object
  lastSeen:          { type: Date, default: Date.now },
  // Network
  ip:                { type: String },
  expiresAt:         { type: Date, required: true },
  revokedAt:         { type: Date, default: null }
}, { timestamps: true });

sessionSchema.index({ refreshToken: 1 });
sessionSchema.index({ userId: 1 });
sessionSchema.index({ deviceFingerprint: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Session', sessionSchema);

