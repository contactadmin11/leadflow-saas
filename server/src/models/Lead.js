const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:        { type: String, required: true, trim: true },
  company:     { type: String, trim: true },
  email:       { type: String, trim: true, lowercase: true },
  phone:       { type: String, trim: true },
  position:    { type: String, trim: true },
  city:        { type: String, trim: true },
  linkedin:    { type: String, trim: true },
  gstin:       { type: String, trim: true, uppercase: true },
  source:      { type: String, trim: true },
  stage:       { type: String, enum: ['New','Contacted','Qualified','Proposal Sent','Negotiation','Won','Lost'], default: 'New' },
  value:       { type: Number, default: 0 },
  probability: { type: Number, default: 50, min: 0, max: 100 },
  score:       { type: Number, default: 5, min: 1, max: 10 },
  assignedTo:  { type: String, trim: true },
  nextFollowUp:{ type: Date },
  wonDate:     { type: Date },
  lostReason:  { type: String },
  tags:        [{ type: String }],
  notes:       { type: String },
  deletedAt:   { type: Date, default: null }
}, { timestamps: true });

leadSchema.index({ userId: 1, deletedAt: 1 });
leadSchema.index({ userId: 1, stage: 1 });
leadSchema.index({ userId: 1, nextFollowUp: 1 });
leadSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Lead', leadSchema);
