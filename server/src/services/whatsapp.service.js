/**
 * WhatsApp Service using @whiskeysockets/baileys
 * Lightweight — does NOT require Chromium/puppeteer.
 * Perfect for free-tier cloud servers (256MB RAM).
 * 
 * Per-user WhatsApp sessions stored in memory (for free tier)
 * or on disk for persistence.
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const path     = require('path');
const fs       = require('fs');
const qrcode   = require('qrcode');
const logger   = require('../config/logger');

// In-memory store of active WA sessions, keyed by userId
const sessions = new Map();
// { userId: { sock, status, qr, qrBase64 } }

const SESSION_DIR = path.join(__dirname, '..', '..', 'wa_sessions');
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

/**
 * Initialize a WhatsApp session for a user.
 * Returns a QR code base64 string or 'connected' status.
 */
const initSession = async (userId) => {
  // If already connected, return status
  const existing = sessions.get(userId);
  if (existing?.status === 'connected') {
    return { status: 'connected', phone: existing.phone };
  }

  const authDir = path.join(SESSION_DIR, userId);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  return new Promise((resolve) => {
    // Baileys requires a Pino-compatible logger with .child() method
    // Using a silent stub so it doesn't flood logs
    const baileysLogger = {
      level: 'silent',
      trace: () => {}, debug: () => {}, info: () => {},
      warn:  () => {}, error: () => {}, fatal: () => {},
      child: () => baileysLogger   // ← .child() is required by Baileys
    };

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: baileysLogger,
      browser: ['LeadFlow CRM', 'Chrome', '1.0.0']
    });

    sessions.set(userId, { sock, status: 'connecting', qr: null, qrBase64: null, phone: null });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      const session = sessions.get(userId);
      if (!session) return;

      if (qr) {
        // New QR code generated
        const qrBase64 = await qrcode.toDataURL(qr);
        session.status  = 'waiting_qr';
        session.qr      = qr;
        session.qrBase64 = qrBase64;
        logger.info(`[WA] QR generated for user ${userId}`);
        resolve({ status: 'waiting_qr', qrBase64 });
      }

      if (connection === 'open') {
        session.status  = 'connected';
        session.qr      = null;
        session.qrBase64 = null;
        session.phone   = sock.user?.id?.split(':')[0];
        logger.info(`[WA] Connected for user ${userId}: ${session.phone}`);
        resolve({ status: 'connected', phone: session.phone });
      }

      if (connection === 'close') {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        logger.warn(`[WA] Disconnected for user ${userId}, reason: ${reason}`);

        if (reason === DisconnectReason.loggedOut) {
          // User logged out — clear session
          sessions.delete(userId);
          try { fs.rmSync(authDir, { recursive: true, force: true }); } catch {}
          session.status = 'logged_out';
        } else {
          // Reconnect
          session.status = 'reconnecting';
          setTimeout(() => initSession(userId).catch(() => {}), 5000);
        }
      }
    });
  });
};

/**
 * Get current WhatsApp status for a user.
 */
const getStatus = (userId) => {
  const session = sessions.get(userId);
  if (!session) return { status: 'not_initialized', ready: false };
  return {
    status: session.status,
    ready:  session.status === 'connected',
    phone:  session.phone || null,
    qrBase64: session.qrBase64 || null
  };
};

/**
 * Disconnect and clear WhatsApp session for a user.
 */
const disconnectSession = async (userId) => {
  const session = sessions.get(userId);
  if (session?.sock) {
    try { await session.sock.logout(); } catch {}
    try { session.sock.end(); } catch {}
  }
  sessions.delete(userId);
  const authDir = path.join(SESSION_DIR, userId);
  try { fs.rmSync(authDir, { recursive: true, force: true }); } catch {}
};

/**
 * Format phone number for WhatsApp JID.
 * Handles Indian numbers (10-digit → prepend 91).
 */
const formatPhone = (phone) => {
  let p = String(phone).replace(/[\s\-\+\(\)]/g, '');
  if (p.length === 10) p = '91' + p;
  if (!p.endsWith('@s.whatsapp.net')) p = p + '@s.whatsapp.net';
  return p;
};

/**
 * Send a WhatsApp message with optional PDF attachment.
 * @param {string} userId    - User's ID (for session lookup)
 * @param {string} phone     - Recipient phone number
 * @param {string} message   - Message text
 * @param {Buffer} pdfBuffer - Optional PDF buffer
 * @param {string} pdfName   - PDF filename
 * @returns {object}         - { success, method }
 */
const sendMessage = async (userId, phone, message, pdfBuffer, pdfName) => {
  const session = sessions.get(userId);
  if (!session || session.status !== 'connected') {
    return { success: false, error: 'WhatsApp not connected. Please scan QR code first.' };
  }

  const jid = formatPhone(phone);

  try {
    // ── Simulate typing to prevent bans ──
    await session.sock.sendPresenceUpdate('composing', jid);
    const typingTime = Math.min(Math.max((message || '').length * 30, 1500), 4000); // 1.5s - 4s
    await new Promise(resolve => setTimeout(resolve, typingTime));
    await session.sock.sendPresenceUpdate('paused', jid);

    if (pdfBuffer && pdfBuffer.length > 10) {
      // Send PDF as document with caption
      await session.sock.sendMessage(jid, {
        document: pdfBuffer,
        fileName: pdfName || 'document.pdf',
        mimetype: 'application/pdf',
        caption:  message
      });
      logger.info(`[WA] PDF sent → ${phone}`);
      return { success: true, method: 'pdf_attached', phone };
    } else {
      // Send text only
      await session.sock.sendMessage(jid, { text: message });
      logger.info(`[WA] Text sent → ${phone}`);
      return { success: true, method: 'text_only', phone };
    }
  } catch (err) {
    logger.error(`[WA] Send error → ${phone}:`, err.message);
    return { success: false, error: err.message, phone };
  }
};

/**
 * Send bulk WhatsApp messages with delay between each.
 */
const sendBulk = async (userId, batch, delaySeconds = 5) => {
  const results = [];
  for (let i = 0; i < batch.length; i++) {
    const { phone, message, pdfBuffer, pdfName } = batch[i];
    logger.info(`[WA Bulk] [${i + 1}/${batch.length}] → ${phone}`);
    const result = await sendMessage(userId, phone, message, pdfBuffer, pdfName);
    results.push(result);
    if (i < batch.length - 1) {
      await new Promise(r => setTimeout(r, delaySeconds * 1000));
    }
  }
  const ok = results.filter(r => r.success).length;
  logger.info(`[WA Bulk] Done: ${ok}/${batch.length}`);
  return { results, total: batch.length, success: ok };
};

module.exports = { initSession, getStatus, disconnectSession, sendMessage, sendBulk };
