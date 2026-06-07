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
    const { phone, message, docType, docId } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    let pdfBuffer = null;
    let pdfName   = null;
    let downloadLink = null;

    if (docType && docId) {
      const { buffer, filename } = await createPDFBuffer(docType, docId, req.user.id);
      pdfBuffer = buffer;
      pdfName   = filename;
      downloadLink = `${process.env.CLIENT_URL || ('https://' + req.get('host'))}/api/public/document/${docType}/${docId}`;
      if (docType === 'invoice') await Invoice.findByIdAndUpdate(docId, { $set: { status: 'Sent' } });
      if (docType === 'quote')   await Quote.findByIdAndUpdate(docId,   { $set: { status: 'Sent' } });
    }

    // Rule 5: Append public download link to WA message, do not send PDF file binary directly
    const finalMessage = downloadLink ? `${message}\n\n📄 Download PDF: ${downloadLink}` : message;
    
    // We pass null for pdfBuffer to skip binary attachment for WA, relying entirely on the link
    const result = await sendMessage(req.user.id, phone, finalMessage, null, null);
    if (!result.success) return res.status(400).json(result);

    await audit({ userId: req.user.id, action: 'WA_SENT', resource: docType || 'message', resourceId: docId, details: { phone }, req });
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * POST /api/send/email
 * Send an email with optional PDF attachment.
 * Body: { toEmail, toName, subject, message, docType?, docId? }
 */
router.post('/email', async (req, res, next) => {
  try {
    const { toEmail, toName, subject, message, docType, docId } = req.body;
    if (!toEmail) return res.status(400).json({ error: 'Email required' });

    const settings = await Settings.findOne({ userId: req.user.id });
    if (!settings) return res.status(400).json({ error: 'Settings not found. Configure email first.' });

    let pdfBuffer = null;
    let pdfName   = null;

    if (docType && docId) {
      const { buffer, filename } = await createPDFBuffer(docType, docId, req.user.id);
      pdfBuffer = buffer;
      pdfName   = filename;
      if (docType === 'invoice') await Invoice.findByIdAndUpdate(docId, { $set: { status: 'Sent' } });
      if (docType === 'quote')   await Quote.findByIdAndUpdate(docId,   { $set: { status: 'Sent' } });
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
    const { phone, toEmail, toName, subject, message, docType, docId } = req.body;
    const settings = await Settings.findOne({ userId: req.user.id });
    const results  = {};

    let pdfBuffer = null;
    let pdfName   = null;
    let downloadLink = null;

    if (docType && docId) {
      const { buffer, filename } = await createPDFBuffer(docType, docId, req.user.id);
      pdfBuffer = buffer;
      pdfName   = filename;
      downloadLink = `${process.env.CLIENT_URL || ('https://' + req.get('host'))}/api/public/document/${docType}/${docId}`;
      if (docType === 'invoice') await Invoice.findByIdAndUpdate(docId, { $set: { status: 'Sent' } });
      if (docType === 'quote')   await Quote.findByIdAndUpdate(docId,   { $set: { status: 'Sent' } });
    }

    if (phone) {
      const waMessage = downloadLink ? `${message}\n\n📄 Download PDF: ${downloadLink}` : message;
      results.whatsapp = await sendMessage(req.user.id, phone, waMessage, null, null);
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
