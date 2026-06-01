const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  leadId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
  type:         { type: String, enum: ['call','email','meeting','task','note'], required: true },
  date:         { type: Date, default: Date.now },
  outcome:      { type: String },
  notes:        { type: String, required: true },
  nextFollowup: { type: Date },
  deletedAt:    { type: Date, default: null }
}, { timestamps: true });

activitySchema.index({ userId: 1, deletedAt: 1 });
activitySchema.index({ leadId: 1 });
activitySchema.index({ date: -1 });

module.exports = mongoose.model('Activity', activitySchema);
