const nodemailer = require('nodemailer');
const { decrypt }  = require('./crypto.service');
const logger       = require('../config/logger');

/**
 * Create a Nodemailer transporter from decrypted user settings.
 */
const createTransporter = (settings) => {
  const gmailUser = decrypt(settings.gmailUserEnc);
  const gmailPass = decrypt(settings.gmailPassEnc);

  if (!gmailUser || !gmailPass) {
    throw new Error('Gmail not configured. Go to Settings → Email Integration and add your Gmail credentials.');
  }

  return {
    transporter: nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass }
    }),
    fromEmail: gmailUser,
    fromName:  settings.gmailFromName || settings.bizName || 'LeadFlow'
  };
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

  await transporter.sendMail(mailOptions);
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
