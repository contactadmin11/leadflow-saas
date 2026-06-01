const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:     { type: String, required: true, trim: true },
  type:     { type: String, enum: ['email','whatsapp','sms','invoice'], required: true },
  subject:  { type: String },
  body:     { type: String, required: true },
  tags:     [{ type: String }],
  useCount: { type: Number, default: 0 },
  deletedAt:{ type: Date, default: null }
}, { timestamps: true });

templateSchema.index({ userId: 1, deletedAt: 1 });
templateSchema.index({ userId: 1, type: 1 });

module.exports = mongoose.model('Template', templateSchema);
