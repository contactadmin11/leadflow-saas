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
    safe.claudeKey = settings.claudeKeyEnc ? '••••••••••••••••' : '';
    safe.openaiKey = settings.openaiKeyEnc ? '••••••••••••••••' : '';
    safe.geminiKey = settings.geminiKeyEnc ? '••••••••••••••••' : '';
    safe.perplexKey= settings.perplexKeyEnc? '••••••••••••••••' : '';
    // Remove encrypted raw fields
    delete safe.gmailUserEnc; delete safe.gmailPassEnc;
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
      'team','sources','gmailFromName','aiProvider','ejsService','ejsTemplate','ejsPublicKey'];
    plain.forEach(k => { if (s[k] !== undefined) upd[k] = s[k]; });

    // Encrypt sensitive fields (only if new value provided and not masked)
    if (s.gmailUser && !s.gmailUser.includes('•')) upd.gmailUserEnc = encrypt(s.gmailUser);
    if (s.gmailPass && !s.gmailPass.includes('•')) upd.gmailPassEnc = encrypt(s.gmailPass);
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

// POST test email — with full verbose error returned to client
router.post('/test-email', async (req, res, next) => {
  try {
    const settings = await Settings.findOne({ userId: req.user.id });
    if (!settings) return res.status(404).json({ error: 'Settings not found. Save settings first.' });

    // Check if gmail creds are saved at all
    if (!settings.gmailUserEnc) return res.status(400).json({ error: 'Gmail address not configured. Go to Settings → Email and save your Gmail address.' });
    if (!settings.gmailPassEnc) return res.status(400).json({ error: 'Gmail App Password not configured. Go to Settings → Email and save your App Password.' });

    const result = await sendTestEmail(settings);
    res.json(result);
  } catch (err) {
    // Return full error details so user knows exactly what's wrong
    res.status(500).json({
      success: false,
      error: err.message,
      code: err.code || null,
      hint: getEmailHint(err)
    });
  }
});

// GET diagnose-email — checks config without actually sending
router.get('/diagnose-email', async (req, res) => {
  try {
    const { decrypt } = require('../services/crypto.service');
    const settings = await Settings.findOne({ userId: req.user.id });
    if (!settings) return res.json({ ok: false, step: 'settings', error: 'No settings document found in database.' });

    const gmailUser = decrypt(settings.gmailUserEnc);
    const gmailPass = decrypt(settings.gmailPassEnc);

    if (!gmailUser) return res.json({ ok: false, step: 'gmail_user', error: 'Gmail address is empty or failed to decrypt. Re-enter it in Settings.' });
    if (!gmailPass) return res.json({ ok: false, step: 'gmail_pass', error: 'App Password is empty or failed to decrypt. Re-enter it in Settings.' });
    if (gmailPass.includes('•')) return res.json({ ok: false, step: 'gmail_pass', error: 'App Password contains masked characters. Re-type it fresh in Settings.' });

    // Try creating transporter and verify connection
    const nodemailer = require('nodemailer');
    require('dns').setDefaultResultOrder('ipv4first');
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: { user: gmailUser, pass: gmailPass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 15000
    });

    await transporter.verify();
    res.json({ ok: true, gmailUser, message: 'SMTP connection verified! Email should work.' });
  } catch (err) {
    res.json({ ok: false, step: 'smtp_connect', error: err.message, code: err.code, hint: getEmailHint(err) });
  }
});

function getEmailHint(err) {
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('invalid login') || msg.includes('username and password')) return 'Wrong Gmail address or App Password. Make sure you use an App Password (not your real Gmail password). Enable 2-Step Verification first, then generate App Password at myaccount.google.com/apppasswords';
  if (msg.includes('less secure')) return 'Enable 2-Step Verification and use App Password instead of your real password.';
  if (msg.includes('not configured') || msg.includes('empty')) return 'Go to Settings → Email Integration and fill in your Gmail and App Password, then click Save.';
  if (msg.includes('timeout') || msg.includes('econnrefused')) return 'Network issue on server. Try again in a moment.';
  if (msg.includes('decrypt')) return 'Encryption mismatch — re-enter your Gmail credentials in Settings and save again.';
  return 'Check Gmail credentials in Settings → Email Integration.';
}

module.exports = router;
