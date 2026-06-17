/**
 * Messenger Routes — Send invoice/quote via WhatsApp + Email with PDF auto-attached.
 * This is the MAIN critical feature.
 */
const express    = require('express');
const Invoice    = require('../models/Invoice');
const Quote      = require('../models/Quote');
const { protect }= require('../middleware/auth');
const { audit }  = require('../services/audit.service');
const { sendEmail }    = require('../services/email.service');
const { sendMessage, sendBulk } = require('../services/whatsapp.service');
const { createPDFBuffer } = require('../services/attachment.service');
const Settings   = require('../models/Settings');
const router = express.Router();

router.use(protect);

/**
 * POST /api/send/whatsapp
 * Send a WhatsApp message with optional PDF attachment.
 * Body: { phone, message, docType?, docId? }
 */
router.post('/whatsapp', async (req, res, next) => {
  try {
    const { phone, message, docType, docId, pdfBase64, fileName } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const mongoose = require('mongoose');
    let pdfBuffer = null;
    let pdfName   = null;

    if (pdfBase64 && fileName) {
      pdfBuffer = Buffer.from(pdfBase64, 'base64');
      pdfName   = fileName;
      if (docId && mongoose.isValidObjectId(docId)) {
        if (docType === 'invoice') await Invoice.findByIdAndUpdate(docId, { $set: { status: 'Sent' } }).catch(()=>null);
        if (docType === 'quote')   await Quote.findByIdAndUpdate(docId,   { $set: { status: 'Sent' } }).catch(()=>null);
      }
    } else if (docType && docId && mongoose.isValidObjectId(docId)) {
      try {
        const { buffer, filename } = await createPDFBuffer(docType, docId, req.user.id);
        pdfBuffer = buffer;
        pdfName   = filename;
      } catch (pdfErr) {
        console.warn('[WA] PDF generation failed, sending text only:', pdfErr.message);
      }
      try {
        if (docType === 'invoice') await Invoice.findByIdAndUpdate(docId, { $set: { status: 'Sent' } });
        if (docType === 'quote')   await Quote.findByIdAndUpdate(docId,   { $set: { status: 'Sent' } });
      } catch(e) { console.warn('[WA] Status update failed:', e.message); }
    } else if (docType && docId) {
      console.warn('[WA] Invalid docId (not ObjectId):', docId, '— sending text only');
    }

    // Send via Baileys — with PDF if available, text-only if not
    const result = await sendMessage(req.user.id, phone, message, pdfBuffer, pdfName);
    if (!result.success) return res.status(400).json(result);

    await audit({ userId: req.user.id, action: 'WA_SENT', resource: docType || 'message', resourceId: docId, details: { phone, withPDF: !!pdfBuffer }, req });
    res.json({ ...result, withPDF: !!pdfBuffer });
  } catch (err) { next(err); }
});

/**
 * POST /api/send/email
 * Send an email with optional PDF attachment.
 * Body: { toEmail, toName, subject, message, docType?, docId? }
 */
router.post('/email', async (req, res, next) => {
  try {
    const { toEmail, toName, subject, message, docType, docId, pdfBase64, fileName } = req.body;
    if (!toEmail) return res.status(400).json({ error: 'Email required' });

    const settings = await Settings.findOne({ userId: req.user.id });
    if (!settings) return res.status(400).json({ error: 'Settings not found. Configure email first.' });

    let pdfBuffer = null;
    let pdfName   = null;

    if (pdfBase64 && fileName) {
      pdfBuffer = Buffer.from(pdfBase64, 'base64');
      pdfName   = fileName;
      if (docId && /^[0-9a-fA-F]{24}$/.test(docId)) {
        if (docType === 'invoice') await Invoice.findByIdAndUpdate(docId, { $set: { status: 'Sent' } }).catch(()=>null);
        if (docType === 'quote')   await Quote.findByIdAndUpdate(docId,   { $set: { status: 'Sent' } }).catch(()=>null);
      }
    } else if (docType && docId && /^[0-9a-fA-F]{24}$/.test(docId)) {
      const { buffer, filename } = await createPDFBuffer(docType, docId, req.user.id);
      pdfBuffer = buffer;
      pdfName   = filename;
      if (docType === 'invoice') await Invoice.findByIdAndUpdate(docId, { $set: { status: 'Sent' } }).catch(()=>null);
      if (docType === 'quote')   await Quote.findByIdAndUpdate(docId,   { $set: { status: 'Sent' } }).catch(()=>null);
    }

    const result = await sendEmail(settings, toEmail, toName, subject, message, pdfBuffer, pdfName);
    await audit({ userId: req.user.id, action: 'EMAIL_SENT', resource: docType || 'message', resourceId: docId, details: { toEmail }, req });
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * POST /api/send/both
 * Send WhatsApp + Email simultaneously with PDF attached to both.
 */
router.post('/both', async (req, res, next) => {
  try {
    const { phone, toEmail, toName, subject, message, docType, docId, pdfBase64, fileName } = req.body;
    const settings = await Settings.findOne({ userId: req.user.id });
    const results  = {};

    let pdfBuffer = null;
    let pdfName   = null;

    if (pdfBase64 && fileName) {
      pdfBuffer = Buffer.from(pdfBase64, 'base64');
      pdfName   = fileName;
      if (docId && /^[0-9a-fA-F]{24}$/.test(docId)) {
        if (docType === 'invoice') await Invoice.findByIdAndUpdate(docId, { $set: { status: 'Sent' } }).catch(()=>null);
        if (docType === 'quote')   await Quote.findByIdAndUpdate(docId,   { $set: { status: 'Sent' } }).catch(()=>null);
      }
    } else if (docType && docId && /^[0-9a-fA-F]{24}$/.test(docId)) {
      const { buffer, filename } = await createPDFBuffer(docType, docId, req.user.id);
      pdfBuffer = buffer;
      pdfName   = filename;
      if (docType === 'invoice') await Invoice.findByIdAndUpdate(docId, { $set: { status: 'Sent' } }).catch(()=>null);
      if (docType === 'quote')   await Quote.findByIdAndUpdate(docId,   { $set: { status: 'Sent' } }).catch(()=>null);
    }

    if (phone) {
      results.whatsapp = await sendMessage(req.user.id, phone, message, pdfBuffer, pdfName);
    }
    if (toEmail && settings) {
      results.email = await sendEmail(
        settings,
        toEmail,
        toName,
        subject || 'Document from ' + (settings.bizName || 'LeadFlow'),
        message,
        pdfBuffer,
        pdfName
      ).catch(err => ({ success: false, error: err.message }));
    }

    await audit({ userId: req.user.id, action: 'BOTH_SENT', resource: docType || 'message', resourceId: docId, req });
    res.json({ success: true, results });
  } catch (err) { next(err); }
});

/**
 * POST /api/send/bulk
 * Bulk WhatsApp send with delay.
 * Body: { batch: [{ phone, message }], delay: 5 }
 */
router.post('/bulk', async (req, res, next) => {
  try {
    const { batch = [], delay = 5 } = req.body;
    const result = await sendBulk(req.user.id, batch, delay);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
