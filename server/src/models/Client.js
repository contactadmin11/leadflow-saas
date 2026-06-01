const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  leadId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  name:          { type: String, required: true, trim: true },
  company:       { type: String, trim: true },
  email:         { type: String, trim: true, lowercase: true },
  phone:         { type: String, trim: true },
  gstin:         { type: String, trim: true, uppercase: true },
  pan:           { type: String, trim: true, uppercase: true },
  state:         { type: String, trim: true },
  industry:      { type: String, trim: true },
  cin:           { type: String, trim: true },
  engagement:    { type: String, trim: true },
  contractValue: { type: Number, default: 0 },
  billingStart:  { type: Date },
  renewalDate:   { type: Date },
  owner:         { type: String, trim: true },
  address:       { type: String, trim: true },
  notes:         { type: String },
  deletedAt:     { type: Date, default: null }
}, { timestamps: true });

clientSchema.index({ userId: 1, deletedAt: 1 });
clientSchema.index({ userId: 1, renewalDate: 1 });

module.exports = mongoose.model('Client', clientSchema);
