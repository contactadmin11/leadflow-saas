const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  bizName:      { type: String, default: '' },
  userName:     { type: String, default: '' },
  email:        { type: String, default: '' },
  phone:        { type: String, default: '' },
  address:      { type: String, default: '' },
  gstin:        { type: String, default: '' },
  pan:          { type: String, default: '' },
  state:        { type: String, default: '' },
  invPrefix:    { type: String, default: 'INV' },
  quotePrefix:  { type: String, default: 'QT' },
  currency:     { type: String, default: '₹' },
  payTerms:     { type: Number, default: 30 },
  upiId:        { type: String, default: '' },
  gstEnabled:   { type: Boolean, default: true },
  team:         [{ type: String }],
  sources:      [{ type: String }],
  // Encrypted fields
  gmailUserEnc: { type: String, default: '' },
  gmailPassEnc: { type: String, default: '' },
  gmailFromName:{ type: String, default: '' },
  // AI provider (local/claude/openai/gemini/perplexity)
  aiProvider:   { type: String, default: 'local' },
  claudeKeyEnc: { type: String, default: '' },
  openaiKeyEnc: { type: String, default: '' },
  geminiKeyEnc: { type: String, default: '' },
  perplexKeyEnc:{ type: String, default: '' },
  // EmailJS
  ejsService:   { type: String, default: '' },
  ejsTemplate:  { type: String, default: '' },
  ejsPublicKey: { type: String, default: '' },
  // Invoice counter
  invCounter:   { type: Number, default: 1 },
  quoteCounter: { type: Number, default: 1 }
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);
