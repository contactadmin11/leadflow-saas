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

const invoiceSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  invoiceNo:   { type: String, required: true },
  clientId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  quoteId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Quote' },
  clientName:  { type: String },
  clientEmail: { type: String },
  clientPhone: { type: String },
  clientGstin: { type: String },
  clientState: { type: String },
  clientAddress:{ type: String },
  status:      { type: String, enum: ['Draft','Sent','Paid','Partial','Overdue','Cancelled'], default: 'Draft' },
  invoiceDate: { type: Date, default: Date.now },
  dueDate:     { type: Date },
  buyerState:  { type: String },
  buyerGstin:  { type: String },
  poReference: { type: String },
  items:       [itemSchema],
  subtotal:    { type: Number, default: 0 },
  cgst:        { type: Number, default: 0 },
  sgst:        { type: Number, default: 0 },
  igst:        { type: Number, default: 0 },
  total:       { type: Number, default: 0 },
  paidAmount:  { type: Number, default: 0 },
  notes:       { type: String },
  deletedAt:   { type: Date, default: null }
}, { timestamps: true });

invoiceSchema.index({ userId: 1, deletedAt: 1 });
invoiceSchema.index({ userId: 1, status: 1 });
invoiceSchema.index({ userId: 1, dueDate: 1 });

module.exports = mongoose.model('Invoice', invoiceSchema);
