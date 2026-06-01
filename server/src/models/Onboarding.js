const mongoose = require('mongoose');

const onboardingSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  clientId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  checklist: { type: mongoose.Schema.Types.Mixed, default: [] },
  progress:  { type: Number, default: 0 },
  owner:     { type: String },
  notes:     { type: String }
}, { timestamps: true });

onboardingSchema.index({ userId: 1, clientId: 1 });

module.exports = mongoose.model('Onboarding', onboardingSchema);
