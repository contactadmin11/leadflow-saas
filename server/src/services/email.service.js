const nodemailer = require('nodemailer');
const { decrypt }  = require('./crypto.service');
const logger       = require('../config/logger');

// Force IPv4 resolution to prevent connection timeouts on Render due to IPv6 blackholing
require('dns').setDefaultResultOrder('ipv4first');

/**
 * Create a Nodemailer transporter from decrypted user settings.
 * Uses Gmail with App Password (SMTP). OAuth2 can be added later via env vars.
 */
const createTransporter = (settings) => {
  const gmailUser = decrypt(settings.gmailUserEnc);
  const gmailPass = decrypt(settings.gmailPassEnc);

  if (!gmailUser || !gmailPass) {
    throw new Error('Gmail not configured. Go to Settings → Email Integration and add your Gmail credentials.');
  }

  return {
    transporter: nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // upgrades to TLS automatically via STARTTLS
      auth: { user: gmailUser, pass: gmailPass },
      tls: {
        rejectUnauthorized: false // Bypass strict cert issues on some hosts
      },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000
    }),
    fromEmail: gmailUser,
    fromName:  settings.gmailFromName || settings.bizName || 'LeadFlow'
  };
};

/**
 * Exponential back-off retry helper.
 * @param {Function} fn - async function to retry
 * @param {number}   maxRetries
 * @param {number}   baseDelayMs
 */
const withRetry = async (fn, maxRetries = 3, baseDelayMs = 1000) => {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        logger.warn(`[Email] Attempt ${attempt} failed (${err.message}). Retrying in ${delay}ms…`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
};

/**
 * Send an email with optional PDF attachment.
 * This is the MAIN send function — preserves all original behavior.
 *
 * @param {object} settings   - User settings from DB (with encrypted fields)
 * @param {string} toEmail    - Recipient email
 * @param {string} toName     - Recipient name
 * @param {string} subject    - Email subject
 * @param {string} message    - Plain-text / HTML body
 * @param {Buffer} pdfBuffer  - Optional PDF buffer to attach
 * @param {string} pdfName    - PDF filename (e.g., 'Invoice-INV-001.pdf')
 * @returns {object}          - { success, method }
 */
const sendEmail = async (settings, toEmail, toName, subject, message, pdfBuffer, pdfName) => {
  const { transporter, fromEmail, fromName } = createTransporter(settings);

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a8a;padding:20px 28px;border-radius:12px 12px 0 0">
        <h2 style="color:#fff;margin:0">${fromName}</h2>
      </div>
      <div style="background:#f8fafc;padding:24px 28px;border:1px solid #e2e8f0">
        <p style="color:#334155;font-size:15px;line-height:1.7;white-space:pre-line">${message}</p>
      </div>
      <div style="background:#1e3a8a;padding:10px 28px;border-radius:0 0 12px 12px;text-align:center">
        <p style="color:#93c5fd;font-size:12px;margin:0">Sent via LeadFlow CRM</p>
      </div>
    </div>
  `;

  const mailOptions = {
    from:    `"${fromName}" <${fromEmail}>`,
    to:      toEmail,
    subject,
    html,
    attachments: pdfBuffer ? [{
      filename:    pdfName || 'document.pdf',
      content:     pdfBuffer,
      contentType: 'application/pdf'
    }] : []
  };

  // Render blocks SMTP on free tier; fail fast (1 attempt) to show the timeout error quickly
  await withRetry(() => transporter.sendMail(mailOptions), 1, 0);

  logger.info(`✅ Email sent → ${toEmail}${pdfBuffer ? ' (with PDF)' : ''}`);
  return { success: true, method: pdfBuffer ? 'email_with_pdf' : 'email_only' };
};

/**
 * Send a test email to verify configuration.
 */
const sendTestEmail = async (settings) => {
  return sendEmail(
    settings,
    decrypt(settings.gmailUserEnc),
    'Test',
    'LeadFlow Email Test ✅',
    'Your email integration is working!\nInvoices will now be sent with PDF auto-attached.\n\n— LeadFlow CRM',
    null,
    null
  );
};

module.exports = { sendEmail, sendTestEmail };
