const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:       { type: String, required: true, trim: true },
  sac:        { type: String, trim: true },
  category:   { type: String, trim: true },
  unit:       { type: String, default: 'Nos' },
  rate:       { type: Number, default: 0 },
  gstRate:    { type: Number, default: 18 },
  description:{ type: String },
  deletedAt:  { type: Date, default: null }
}, { timestamps: true });

productSchema.index({ userId: 1, deletedAt: 1 });

module.exports = mongoose.model('Product', productSchema);
