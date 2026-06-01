const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  sac:       String,
  qty:       { type: Number, default: 1 },
  rate:      { type: Number, default: 0 },
  gstRate:   { type: Number, default: 18 },
  amount:    { type: Number, default: 0 },
  gstAmount: { type: Number, default: 0 },
  total:     { type: Number, default: 0 }
}, { _id: false });

const quoteSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  quoteNo:   { type: String, required: true },
  clientId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  leadId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  clientName:{ type: String },
  clientEmail:{ type: String },
  clientPhone:{ type: String },
  clientGstin:{ type: String },
  clientState:{ type: String },
  status:    { type: String, enum: ['Draft','Sent','Approved','Rejected','Converted'], default: 'Draft' },
  validTill: { type: Date },
  buyerState:{ type: String },
  terms:     { type: String },
  notes:     { type: String },
  items:     [itemSchema],
  subtotal:  { type: Number, default: 0 },
  cgst:      { type: Number, default: 0 },
  sgst:      { type: Number, default: 0 },
  igst:      { type: Number, default: 0 },
  total:     { type: Number, default: 0 },
  deletedAt: { type: Date, default: null }
}, { timestamps: true });

quoteSchema.index({ userId: 1, deletedAt: 1 });
quoteSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('Quote', quoteSchema);
