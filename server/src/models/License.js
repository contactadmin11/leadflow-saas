const mongoose = require('mongoose');

const licenseSchema = new mongoose.Schema({
  key:           { type: String, required: true, unique: true, uppercase: true },
  clientName:    { type: String, required: true },
  clientEmail:   { type: String },
  clientMobile:  { type: String },
  plan:          { type: String, enum: ['trial','1month','3months','6months','1year','custom'], required: true },
  maxUsers:      { type: Number, default: 1 },
  expiresAt:     { type: Date, required: true },
  status:        { type: String, enum: ['active','expiring','expired','revoked'], default: 'active' },
  price:         { type: Number, default: 0 },
  notes:         { type: String },
  activeDevices: { type: Number, default: 0 },
  lastVerifiedAt:{ type: Date },
  daysRemaining: { type: Number, default: 0 },
  // Device binding — stores fingerprints of bound devices
  boundDevices:  [{ type: String }],
  maxDevices:    { type: Number, default: 1 }

}, { timestamps: true });

licenseSchema.index({ key: 1 });
licenseSchema.index({ status: 1 });
licenseSchema.index({ expiresAt: 1 });

// Auto-calculate status and daysRemaining
licenseSchema.pre('save', function(next) {
  const now = new Date();
  const diff = Math.ceil((this.expiresAt - now) / (1000 * 60 * 60 * 24));
  this.daysRemaining = Math.max(0, diff);
  if (this.status !== 'revoked') {
    if (diff <= 0) this.status = 'expired';
    else if (diff <= 7) this.status = 'expiring';
    else this.status = 'active';
  }
  next();
});

module.exports = mongoose.model('License', licenseSchema);
