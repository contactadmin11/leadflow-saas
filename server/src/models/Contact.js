const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  leadId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  name:     { type: String, required: true, trim: true },
  company:  { type: String, trim: true },
  email:    { type: String, trim: true, lowercase: true },
  phone:    { type: String, trim: true },
  position: { type: String, trim: true },
  city:     { type: String, trim: true },
  linkedin: { type: String, trim: true },
  notes:    { type: String },
  deletedAt:{ type: Date, default: null }
}, { timestamps: true });

contactSchema.index({ userId: 1, deletedAt: 1 });

module.exports = mongoose.model('Contact', contactSchema);
