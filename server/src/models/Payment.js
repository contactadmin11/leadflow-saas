const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
  amount:    { type: Number, required: true },
  date:      { type: Date, default: Date.now },
  mode:      { type: String, default: 'UPI' },
  reference: { type: String },
  tds:       { type: Number, default: 0 },
  deletedAt: { type: Date, default: null }
}, { timestamps: true });

paymentSchema.index({ userId: 1, deletedAt: 1 });
paymentSchema.index({ invoiceId: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
