const express    = require('express');
const Settings   = require('../models/Settings');
const { protect }= require('../middleware/auth');
const { encrypt, decrypt } = require('../services/crypto.service');
const { audit }  = require('../services/audit.service');
const { sendTestEmail } = require('../services/email.service');
const router     = express.Router();

router.use(protect);

// GET settings (decrypt sensitive fields for client)
router.get('/', async (req, res, next) => {
  try {
    let settings = await Settings.findOne({ userId: req.user.id });
    if (!settings) settings = await Settings.create({ userId: req.user.id });

    const safe = settings.toObject();
    // Return decrypted versions for display (masked)
    safe.gmailUser = decrypt(settings.gmailUserEnc) || '';
    safe.gmailPass = settings.gmailPassEnc ? '••••••••••••••••' : '';
    safe.resendKey = settings.resendKeyEnc ? '••••••••••••••••' : '';
    safe.claudeKey = settings.claudeKeyEnc ? '••••••••••••••••' : '';
    safe.openaiKey = settings.openaiKeyEnc ? '••••••••••••••••' : '';
    safe.geminiKey = settings.geminiKeyEnc ? '••••••••••••••••' : '';
    safe.perplexKey= settings.perplexKeyEnc? '••••••••••••••••' : '';
    // Remove encrypted raw fields
    delete safe.gmailUserEnc; delete safe.gmailPassEnc; delete safe.resendKeyEnc;
    delete safe.claudeKeyEnc; delete safe.openaiKeyEnc;
    delete safe.geminiKeyEnc; delete safe.perplexKeyEnc;
    res.json({ settings: safe });
  } catch (err) { next(err); }
});

// PUT settings
router.put('/', async (req, res, next) => {
  try {
    const s   = req.body;
    const upd = {};

    const plain = ['bizName','userName','email','phone','address','gstin','pan','state',
      'invPrefix','quotePrefix','currency','upiId','gstEnabled','payTerms',
      'team','sources','gmailFromName','resendFrom','aiProvider','ejsService','ejsTemplate','ejsPublicKey'];
    plain.forEach(k => { if (s[k] !== undefined) upd[k] = s[k]; });

    // Encrypt sensitive fields (only if new value provided and not masked)
    if (s.gmailUser && !s.gmailUser.includes('•')) upd.gmailUserEnc = encrypt(s.gmailUser);
    if (s.gmailPass && !s.gmailPass.includes('•')) upd.gmailPassEnc = encrypt(s.gmailPass);
    if (s.resendKey && !s.resendKey.includes('•')) upd.resendKeyEnc = encrypt(s.resendKey);
    if (s.claudeKey && !s.claudeKey.includes('•')) upd.claudeKeyEnc = encrypt(s.claudeKey);
    if (s.openaiKey && !s.openaiKey.includes('•')) upd.openaiKeyEnc = encrypt(s.openaiKey);
    if (s.geminiKey && !s.geminiKey.includes('•')) upd.geminiKeyEnc = encrypt(s.geminiKey);
    if (s.perplexKey&& !s.perplexKey.includes('•'))upd.perplexKeyEnc = encrypt(s.perplexKey);

    const settings = await Settings.findOneAndUpdate(
      { userId: req.user.id },
      { $set: upd },
      { new: true, upsert: true }
    );
    await audit({ userId: req.user.id, action: 'SETTINGS_UPDATED', resource: 'Settings', req });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST test email
router.post('/test-email', async (req, res, next) => {
  try {
    const settings = await Settings.findOne({ userId: req.user.id });
    if (!settings) return res.status(404).json({ error: 'Settings not found' });
    const result = await sendTestEmail(settings);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
