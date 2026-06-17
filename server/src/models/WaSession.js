const mongoose = require('mongoose');

/**
 * Stores Baileys WhatsApp auth credentials in MongoDB.
 * This allows sessions to survive server restarts on Render.
 * key: "userId:filename" (e.g. "abc123:creds.json")
 */
const waSessionSchema = new mongoose.Schema({
  key:     { type: String, required: true, unique: true, index: true },
  data:    { type: String, required: true }, // JSON stringified cred data
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('WaSession', waSessionSchema);
