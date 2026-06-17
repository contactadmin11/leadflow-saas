/**
 * WhatsApp Service using @whiskeysockets/baileys
 * ─────────────────────────────────────────────
 * Sessions are stored in MongoDB (not disk) so they survive Render restarts.
 * Users only need to scan QR ONCE — after that the session auto-reconnects.
 */

const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  BufferJSON,
  initAuthCreds,
  proto
} = require('@whiskeysockets/baileys');
const { Boom }  = require('@hapi/boom');
const qrcode    = require('qrcode');
const logger    = require('../config/logger');
const WaSession = require('../models/WaSession');

// In-memory store of active WA sockets, keyed by userId
const sessions = new Map();

/* ─── MongoDB-backed auth state ─────────────────────────────────────────── */

/**
 * Replicates useMultiFileAuthState but reads/writes to MongoDB.
 * Each file is stored as a WaSession document with key = "userId:filename".
 */
const useMongoAuthState = async (userId) => {
  const prefix = `${userId}:`;

  const readData = async (file) => {
    const doc = await WaSession.findOne({ key: prefix + file }).lean();
    if (!doc) return null;
    return JSON.parse(doc.data, BufferJSON.reviver);
  };

  const writeData = async (file, data) => {
    const value = JSON.stringify(data, BufferJSON.replacer);
    await WaSession.findOneAndUpdate(
      { key: prefix + file },
      { $set: { data: value, updatedAt: new Date() } },
      { upsert: true }
    );
  };

  const removeData = async (file) => {
    await WaSession.deleteOne({ key: prefix + file });
  };

  // Load or init creds
  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            let value = await readData(`${type}-${id}`);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }));
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const file  = `${category}-${id}`;
              tasks.push(value ? writeData(file, value) : removeData(file));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => writeData('creds', creds)
  };
};

/* ─── Session management ─────────────────────────────────────────────────── */

const baileysLogger = {
  level: 'silent',
  trace: () => {}, debug: () => {}, info: () => {},
  warn:  () => {}, error: () => {}, fatal: () => {},
  child: () => baileysLogger
};

/**
 * Initialize a WhatsApp session for a user.
 * If credentials already exist in MongoDB, reconnects automatically (no QR).
 * If not, returns a QR code for the user to scan.
 */
const initSession = async (userId) => {
  // If already connected in memory, skip
  const existing = sessions.get(userId);
  if (existing?.status === 'connected') {
    return { status: 'connected', phone: existing.phone };
  }

  const { state, saveCreds } = await useMongoAuthState(userId);
  const { version } = await fetchLatestBaileysVersion();

  return new Promise((resolve) => {
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
        const qrBase64 = await qrcode.toDataURL(qr);
        session.status   = 'waiting_qr';
        session.qr       = qr;
        session.qrBase64 = qrBase64;
        logger.info(`[WA] QR generated for user ${userId}`);
        resolve({ status: 'waiting_qr', qrBase64 });
      }

      if (connection === 'open') {
        session.status   = 'connected';
        session.qr       = null;
        session.qrBase64 = null;
        session.phone    = sock.user?.id?.split(':')[0];
        logger.info(`[WA] Connected for user ${userId}: ${session.phone}`);
        resolve({ status: 'connected', phone: session.phone });
      }

      if (connection === 'close') {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        logger.warn(`[WA] Disconnected for user ${userId}, reason: ${reason}`);

        if (reason === DisconnectReason.loggedOut) {
          // User explicitly logged out — delete credentials from MongoDB too
          sessions.delete(userId);
          session.status = 'logged_out';
          await WaSession.deleteMany({ key: new RegExp(`^${userId}:`) });
          logger.info(`[WA] Session credentials wiped for user ${userId}`);
        } else {
          // Network drop / Render restart — reconnect using stored credentials
          session.status = 'reconnecting';
          logger.info(`[WA] Auto-reconnecting for user ${userId} in 5s…`);
          setTimeout(() => initSession(userId).catch(() => {}), 5000);
        }
      }
    });
  });
};

/* ─── Auto-restore sessions on server boot ───────────────────────────────── */

/**
 * Called once on startup to reconnect all users who had active sessions.
 * This means after a Render restart, users automatically reconnect without QR.
 */
const restoreAllSessions = async () => {
  try {
    // Find all unique userIds that have saved credentials
    const docs = await WaSession.find({ key: /^.*:creds$/ }).lean();
    const userIds = docs.map(d => d.key.replace(/:creds$/, ''));
    logger.info(`[WA] Restoring ${userIds.length} session(s) from MongoDB…`);
    for (const userId of userIds) {
      try {
        await initSession(userId);
        logger.info(`[WA] Restored session for ${userId}`);
      } catch (e) {
        logger.warn(`[WA] Failed to restore session for ${userId}: ${e.message}`);
      }
    }
  } catch (err) {
    logger.error('[WA] restoreAllSessions error:', err.message);
  }
};

/* ─── Status / disconnect ────────────────────────────────────────────────── */

const getStatus = (userId) => {
  const session = sessions.get(userId);
  if (!session) return { status: 'not_initialized', ready: false };
  return {
    status:   session.status,
    ready:    session.status === 'connected',
    phone:    session.phone || null,
    qrBase64: session.qrBase64 || null
  };
};

const disconnectSession = async (userId) => {
  const session = sessions.get(userId);
  if (session?.sock) {
    try { await session.sock.logout(); } catch {}
    try { session.sock.end(); } catch {}
  }
  sessions.delete(userId);
  // Remove all credential documents for this user from MongoDB
  await WaSession.deleteMany({ key: new RegExp(`^${userId}:`) });
  logger.info(`[WA] Session disconnected and credentials deleted for ${userId}`);
};

/* ─── Phone formatter ────────────────────────────────────────────────────── */

const formatPhone = (phone) => {
  let p = String(phone).replace(/[\s\-\+\(\)]/g, '');
  if (p.length === 10) p = '91' + p;
  if (!p.endsWith('@s.whatsapp.net')) p = p + '@s.whatsapp.net';
  return p;
};

/* ─── Send message ───────────────────────────────────────────────────────── */

const sendMessage = async (userId, phone, message, pdfBuffer, pdfName) => {
  const session = sessions.get(userId);
  if (!session || session.status !== 'connected') {
    return { success: false, error: 'WhatsApp not connected. Please scan QR code first.' };
  }

  const jid = formatPhone(phone);

  try {
    // Simulate typing to look human and prevent bans
    await session.sock.sendPresenceUpdate('composing', jid);
    const typingTime = Math.min(Math.max((message || '').length * 30, 1500), 4000);
    await new Promise(resolve => setTimeout(resolve, typingTime));
    await session.sock.sendPresenceUpdate('paused', jid);

    if (pdfBuffer && pdfBuffer.length > 10) {
      await session.sock.sendMessage(jid, {
        document: pdfBuffer,
        fileName: pdfName || 'document.pdf',
        mimetype: 'application/pdf',
        caption:  message
      });
      logger.info(`[WA] PDF sent → ${phone}`);
      return { success: true, method: 'pdf_attached', phone };
    } else {
      await session.sock.sendMessage(jid, { text: message });
      logger.info(`[WA] Text sent → ${phone}`);
      return { success: true, method: 'text_only', phone };
    }
  } catch (err) {
    logger.error(`[WA] Send error → ${phone}:`, err.message);
    return { success: false, error: err.message, phone };
  }
};

/* ─── Bulk send ──────────────────────────────────────────────────────────── */

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

module.exports = { initSession, getStatus, disconnectSession, sendMessage, sendBulk, restoreAllSessions };
