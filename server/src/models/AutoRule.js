const mongoose = require('mongoose');

const autoRuleSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:      { type: String, required: true },
  trigger:   { type: String, required: true },
  condition: { type: mongoose.Schema.Types.Mixed },
  actions:   { type: mongoose.Schema.Types.Mixed, required: true },
  enabled:   { type: Boolean, default: true },
  runCount:  { type: Number, default: 0 },
  isBuiltin: { type: Boolean, default: false }
}, { timestamps: true });

autoRuleSchema.index({ userId: 1, enabled: 1 });

module.exports = mongoose.model('AutoRule', autoRuleSchema);
