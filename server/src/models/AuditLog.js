const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action:     { type: String, required: true },
  resource:   { type: String, required: true },
  resourceId: { type: String },
  details:    { type: mongoose.Schema.Types.Mixed },
  ip:         { type: String },
  userAgent:  { type: String },
  success:    { type: Boolean, default: true }
}, { timestamps: true });

auditLogSchema.index({ userId: 1 });
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1 });
// Auto-delete logs older than 90 days
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
