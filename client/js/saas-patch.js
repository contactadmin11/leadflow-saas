/**
 * LeadFlow SaaS Integration Patch
 * ═══════════════════════════════════════════════════════════════
 * This file patches the original LeadFlow app to work with the
 * SaaS backend. Load AFTER api.js and bridge.js.
 *
 * What this does:
 * 1. Replaces doLogin() with API-based login
 * 2. Patches WA send to use new API /api/send/whatsapp
 * 3. Patches email send to use new API /api/send/email
 * 4. Patches WA status check to use new API /api/wa/status
 * 5. Loads all data from API after login
 * 6. Adds Register screen support
 * 7. Adds Logout button
 * ═══════════════════════════════════════════════════════════════
 */

// ── Point WA_SERVER to new API ─────────────────────────────────────────────
// This variable is used throughout the original app for all API calls.
// We redirect it to our new backend.
if (typeof window !== 'undefined') {
  window.LEADFLOW_API_URL = window.LEADFLOW_API_URL ||
    (window.location.hostname === 'localhost' ? 'http://localhost:3001/api' : '/api');
}

// ── Override doLogin to use real API auth ────────────────────────────────────
window.doLogin = async function() {
  const emailInput = document.getElementById('loginUser');
  const passInput  = document.getElementById('loginPass');
  const errEl      = document.getElementById('loginErr');
  const btnEl      = document.getElementById('loginBtn');

  const emailOrUser = (emailInput?.value || '').trim();
  const password    = (passInput?.value || '').trim();

  if (!emailOrUser || !password) {
    if (errEl) { errEl.textContent = 'Enter your email and password'; errEl.style.display = 'block'; }
    return;
  }

  // Determine if it's an email or username
  const email = emailOrUser.includes('@') ? emailOrUser : emailOrUser;

  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in...'; }
  if (errEl) errEl.style.display = 'none';

  try {
    const data = await API.login(email, password);

    window.currentUser = data.user?.name || data.user?.email || email;
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';

    const avatarEl = document.getElementById('topbarAvatar');
    if (avatarEl) avatarEl.textContent = window.currentUser[0].toUpperCase();

    // Show loading overlay while fetching data
    _showLoadingOverlay('Loading your data from cloud...');

    // Load all data from API into localStorage (bridge)
    await window.bridgeLoadAllData();

    _hideLoadingOverlay();

    if (typeof init === 'function') init();
    if (typeof toast === 'function') toast('Welcome back, ' + window.currentUser + '! 🎯', 'success');

    _patchTopbarWithLogout();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message || 'Login failed. Check your credentials.';
      errEl.style.display = 'block';
    }
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In'; }
  }
};

// ── Override WA status check to use new API ───────────────────────────────
window.checkWANodeServer = async function(silent = false) {
  try {
    const d = await API.waStatus();
    window.waNodeReady = window.waServerReady = d.ready;

    const statusMap = {
      connected:   { bg: '#f0fdf4', color: '#166534', text: '✅ WhatsApp Connected — PDFs will auto-attach!' },
      waiting_qr:  { bg: '#fef9c3', color: '#854d0e', text: '📱 Scan QR code below' },
      starting:    { bg: '#eff6ff', color: '#1e40af', text: '⏳ Server starting…' },
      reconnecting:{ bg: '#eff6ff', color: '#1e40af', text: '⏳ Reconnecting…' },
      not_initialized: { bg: '#f1f5f9', color: '#64748b', text: '⚪ WhatsApp not initialized. Click Init WA.' }
    };

    const s = statusMap[d.status] || { bg: '#fef2f2', color: '#991b1b', text: '❌ Not connected' };
    const el = document.getElementById('waNodeStatus');
    if (el) { el.style.background = s.bg; el.style.color = s.color; el.textContent = s.text; }

    // Show QR if available
    if (d.qrBase64) {
      const qrEl = document.getElementById('waQRCode');
      if (qrEl) { qrEl.innerHTML = `<img src="${d.qrBase64}" style="width:200px;height:200px;border-radius:10px;" alt="Scan QR">`; }
    }

    if (typeof _updateWABadge === 'function') _updateWABadge(s);
    if (!silent && !d.ready && typeof toast === 'function') toast(s.text, 'info', 4000);
    return d.ready;
  } catch (e) {
    window.waNodeReady = window.waServerReady = false;
    const s = { bg: '#f1f5f9', color: '#64748b', text: '⚪ Could not reach API server' };
    const el = document.getElementById('waNodeStatus');
    if (el) { el.style.background = s.bg; el.style.color = s.color; el.textContent = s.text; }
    if (typeof _updateWABadge === 'function') _updateWABadge(s);
    return false;
  }
};
window.checkWAServer = window.checkWANodeServer;

window.reconnectWANodeServer = async function() {
  if (typeof toast === 'function') toast('🔄 Initializing WhatsApp...', 'info', 3000);
  try {
    const result = await API.waInit();
    if (result.qrBase64) {
      const qrEl = document.getElementById('waQRCode');
      if (qrEl) {
        qrEl.innerHTML = `
          <div style="text-align:center;padding:16px">
            <p style="margin-bottom:12px;font-weight:600">Scan this QR code with WhatsApp:</p>
            <img id="waQRImg" src="${result.qrBase64}" style="width:220px;height:220px;border-radius:12px;border:3px solid #3b82f6" alt="QR Code">
            <p style="margin-top:10px;font-size:12px;color:#64748b">WhatsApp → Settings → Linked Devices → Link Device</p>
            <p style="margin-top:8px;font-size:12px;color:#f59e0b" id="waPollingMsg"><i class="fas fa-spinner fa-spin"></i> Waiting for scan... <span id="waCountdown">3:00</span></p>
            <button onclick="if(window.waPollInterval)clearInterval(window.waPollInterval);window.reconnectWANodeServer()" style="margin-top:10px;padding:6px 14px;background:#3b82f6;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px">🔄 Refresh QR</button>
          </div>`;
      }
      if (typeof toast === 'function') toast('📱 Scan QR code to connect WhatsApp!', 'info', 8000);

      // ── Countdown timer display ─────────────────────────────────────────
      let secondsLeft = 180; // 3 minutes
      const countdownEl = () => document.getElementById('waCountdown');
      const countdownInterval = setInterval(() => {
        secondsLeft--;
        const el = countdownEl();
        if (el) {
          const m = Math.floor(secondsLeft / 60);
          const s = String(secondsLeft % 60).padStart(2, '0');
          el.textContent = `${m}:${s}`;
        }
        if (secondsLeft <= 0) clearInterval(countdownInterval);
      }, 1000);

      // ── Polling — checks status AND refreshes QR if a new one is available ──
      if (window.waPollInterval) clearInterval(window.waPollInterval);
      let attempts = 0;
      window.waPollInterval = setInterval(async () => {
        attempts++;
        if (attempts > 60) {
          clearInterval(window.waPollInterval);
          clearInterval(countdownInterval);
          const msgEl = document.getElementById('waPollingMsg');
          if (msgEl) msgEl.innerHTML = '<span style="color:#ef4444">⏰ QR expired. Click Refresh QR to get a new code.</span>';
          return;
        }
        try {
          const status = await API.waStatus();
          // If connected — stop polling and show success
          if (status.ready || status.status === 'connected') {
            clearInterval(window.waPollInterval);
            clearInterval(countdownInterval);
            if (qrEl) qrEl.innerHTML = '<div style="color:#10b981;font-weight:bold;text-align:center;padding:20px"><i class="fas fa-check-circle" style="font-size:40px"></i><br><br>WhatsApp Connected!<br><span style="font-size:13px;font-weight:400;color:#64748b">PDFs will now auto-attach when you send invoices</span></div>';
            checkWANodeServer(false);
            if (typeof toast === 'function') toast('✅ WhatsApp connected! PDFs will auto-attach.', 'success', 6000);
          }
          // If a new QR is available — update the image (QR rotates every ~20s)
          if (status.qrBase64) {
            const imgEl = document.getElementById('waQRImg');
            if (imgEl && imgEl.src !== status.qrBase64) imgEl.src = status.qrBase64;
          }
        } catch(e){}
      }, 3000);

    } else if (result.status === 'connected') {
      if (typeof toast === 'function') toast('✅ WhatsApp already connected!', 'success');
      checkWANodeServer(false);
    } else {
      if (typeof toast === 'function') toast('⚠️ WA status: ' + (result.status || 'unknown'), 'info', 5000);
    }
  } catch(e) {
    if (typeof toast === 'function') toast('WA init failed: ' + e.message, 'error');
  }
};
window.reconnectWAServer = window.reconnectWANodeServer;

// ── Override WA send — use new API with server-side PDF ──────────────────────
window._sendViaLocalServer = async function(phone, message, type, id, toEmail = '', toName = '', subject = '', channel = 'wa') {
  const statusEl = document.getElementById('sdPdfReady');
  const docType  = type; // 'invoice' or 'quote'

  // Find the real DB ID for this document
  // The original app uses local IDs; we need to find the MongoDB _id
  const docId = await _resolveDocId(docType, id);

  try {
    if (channel === 'wa' || channel === 'both') {
      if (!phone) throw new Error('Phone number required');
      if (statusEl) statusEl.innerHTML = '<span style="color:#f59e0b">⏳ Generating PDF and sending via WhatsApp…</span>';

      const result = await API.sendWA({
        phone, message,
        docType: docType,
        docId:   docId || id
      });

      if (result.success) {
        if (statusEl) statusEl.innerHTML = '<span style="color:#10b981;font-weight:700">✅ PDF sent via WhatsApp!</span>';
        if (typeof toast === 'function') toast('✅ Document sent via WhatsApp with PDF!', 'success', 5000);
      } else {
        throw new Error(result.error || 'WA send failed');
      }
    }

    if (channel === 'email' || channel === 'both') {
      if (!toEmail) return;
      if (statusEl) statusEl.innerHTML = '<span style="color:#f59e0b">⏳ Sending email with PDF…</span>';
      await _sendEmailWithPDF(toEmail, toName, subject, message, docType, docId || id);
    }

  } catch (e) {
    console.error('[SaaS Patch] Send error:', e);
    const isConfigError = e.message.toLowerCase().includes('phone number required') || e.message.toLowerCase().includes('not connected');
    if (isConfigError) {
      if (typeof toast === 'function') toast('❌ WhatsApp not connected. Scan QR code in settings to auto-attach PDFs!', 'error', 8000);
      if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444;font-weight:700">❌ WhatsApp not connected! PDF not attached.</span>';
    } else {
      if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444">❌ ${e.message}</span>`;
      if (typeof toast === 'function') toast('Send failed: ' + e.message, 'error', 5000);
    }
    
    // Fallback to SameBrowser WA
    if (channel === 'wa' || channel === 'both') {
      if (typeof _sendViaSameBrowserWA === 'function') {
         _sendViaSameBrowserWA(phone, message, type, docId || id);
      }
    }
  }
};

// ── Same-browser WhatsApp override ────────────────────────────────────────────
// Strategy:
//   IF WhatsApp connected via backend (Baileys):
//     → Send via API (with PDF if possible, text-only if PDF fails)
//     → NEVER open WhatsApp Web
//   IF not connected:
//     → Download PDF to browser + Open WhatsApp Web + Show attach guide
window._sendViaSameBrowserWA = async function(phone, message, type, id) {
  const resolvedId = await _resolveDocId(type, id);
  const isWAConnected = !!(window.waNodeReady || window.waServerReady);

  // ══════════════════════════════════════════════════════════
  // PATH 1: WhatsApp connected via Baileys → backend API only
  // ══════════════════════════════════════════════════════════
  if (isWAConnected && typeof API !== 'undefined' && API.isLoggedIn()) {
    const statusEl = document.getElementById('sdPdfReady');
    if (statusEl) statusEl.innerHTML = '<span style="color:#f59e0b">⏳ Sending via WhatsApp…</span>';

    try {
      const payload = { phone, message };
      // Add doc info only if we have valid IDs (PDF will be attached if doc found)
      if (type && (resolvedId || id)) {
        payload.docType = type;
        payload.docId   = resolvedId || id;
      }

      const result = await API.sendWA(payload);

      if (result && result.success) {
        const withPDF = result.method === 'pdf_attached';
        if (statusEl) statusEl.innerHTML = `<span style="color:#10b981;font-weight:700">✅ ${withPDF ? 'PDF sent via WhatsApp!' : 'Message sent via WhatsApp!'}</span>`;
        if (typeof toast === 'function') toast(withPDF ? '✅ PDF sent via WhatsApp!' : '✅ Message sent via WhatsApp!', 'success', 5000);
        return; // ✅ Done — WhatsApp Web will NOT open
      } else {
        throw new Error((result && result.error) || 'Send failed');
      }
    } catch (e) {
      // Even on error — if WA is connected, show error & do NOT open WA Web
      const errMsg = e.message || 'Unknown error';
      if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444">❌ WA Send failed: ${errMsg}</span>`;
      if (typeof toast === 'function') toast('❌ WhatsApp send failed: ' + errMsg, 'error', 6000);
      console.error('[WA] Backend send error:', e);
      return; // ✅ Still do NOT open WA Web — user will see error toast
    }
  }

  // ══════════════════════════════════════════════════════════
  // PATH 2: WhatsApp NOT connected → manual attach flow
  // ══════════════════════════════════════════════════════════
  let fname = 'document.pdf';
  try {
    if (window._sdPdfResult && window._sdPdfResult.blob) {
      fname = window._sdPdfResult.fname || fname;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(window._sdPdfResult.blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    } else if (type && id && typeof buildDocPDF === 'function') {
      const result = await buildDocPDF(type, id);
      if (result && result.blob) {
        fname = result.fname || fname;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(result.blob);
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      }
    }
  } catch (pdfErr) {
    console.warn('[WA] PDF download failed:', pdfErr.message);
  }

  // Open WhatsApp Web with message pre-filled
  const waUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
  window.open(waUrl, 'whatsapp_web_tab');

  // Show step-by-step attach guide
  const ex = document.getElementById('waGuideOverlay');
  if (ex) ex.remove();
  const d = document.createElement('div');
  d.id = 'waGuideOverlay';
  d.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1e3a8a;color:#fff;border-radius:14px;padding:16px 20px;z-index:9999;max-width:300px;box-shadow:0 8px 32px rgba(0,0,0,.4);font-size:13px;line-height:1.7';
  d.innerHTML = `<div style="font-weight:700;font-size:14px;margin-bottom:8px">📎 PDF downloaded!</div>
    <div>In WhatsApp Web tab:</div>
    <div>1️⃣ Click <strong>📎</strong> → <strong>Document</strong></div>
    <div>2️⃣ Select <strong>${fname}</strong> from Downloads</div>
    <div>3️⃣ Click <strong>Send</strong> ✅</div>
    <div style="margin-top:8px;font-size:11px;color:#93c5fd">💡 Connect WhatsApp in Settings for auto-send</div>
    <button onclick="document.getElementById('waGuideOverlay').remove()" style="margin-top:10px;background:rgba(255,255,255,.2);border:none;color:#fff;padding:5px 14px;border-radius:6px;cursor:pointer;width:100%">Got it ✓</button>`;
  document.body.appendChild(d);
  setTimeout(() => { if (d.parentNode) d.remove(); }, 15000);

  if (typeof toast === 'function') {
    toast(`📥 PDF "${fname}" downloaded — attach it in WhatsApp Web`, 'info', 8000);
  }
};

window._sendEmailWithPDF = async function(email, name, subject, message, type, id) {
  if (!email) {
    if (typeof toast === 'function') toast('❌ No email address found for this contact.', 'error', 6000);
    return;
  }

  const docId = await _resolveDocId(type, id);
  const statusEl = document.getElementById('sdPdfReady');
  if (statusEl) statusEl.innerHTML = '<span style="color:#f59e0b">⏳ Sending email with PDF attachment…</span>';

  try {
    const result = await API.sendEmail({
      toEmail:  email,
      toName:   name || email,
      subject:  subject,
      message:  message,
      docType:  type,
      docId:    docId || id
    });

    if (result.success) {
      if (typeof toast === 'function') toast(`✅ Email with PDF sent to ${email}!`, 'success', 5000);
      if (statusEl) statusEl.innerHTML = '<span style="color:#10b981;font-weight:700">✅ Email sent with PDF attached!</span>';
    } else {
      throw new Error(result.error || 'Email send failed');
    }
  } catch(e) {
    const errMsg = e.message || '';
    const isGmailMissing = errMsg.toLowerCase().includes('gmail not configured')
      || errMsg.toLowerCase().includes('settings not found')
      || errMsg.toLowerCase().includes('no gmail')
      || errMsg.toLowerCase().includes('smtp')
      || errMsg.toLowerCase().includes('credentials');

    if (isGmailMissing) {
      // Clear, actionable error with steps
      const setupMsg = '❌ Gmail not configured. To fix:<br>' +
        '1. Go to <b>Settings → Email Integration</b><br>' +
        '2. Enter your Gmail address<br>' +
        '3. Enter your 16-character Gmail App Password<br>' +
        '(<a href="https://myaccount.google.com/apppasswords" target="_blank" style="color:#3b82f6">Get App Password here</a>)';
      if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444;font-weight:700">${setupMsg}</span>`;
      if (typeof toast === 'function') toast(
        '❌ Gmail not set up. Go to Settings → Email Integration to configure it.',
        'error', 10000
      );
    } else {
      if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444">❌ Email failed: ${errMsg}</span>`;
      if (typeof toast === 'function') toast('Email failed: ' + errMsg, 'error', 5000);
    }

    // Fallback — open mailto so the user can still send manually
    if (typeof _autoDownloadPDF === 'function') _autoDownloadPDF();
    setTimeout(() => {
      window.open(`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`, '_blank');
    }, 500);

    throw e;
  }
};
window._sendEmailResend = window._sendEmailWithPDF;

/**
 * Resolve local app ID → MongoDB _id
 * The original app uses local string IDs (uids). We need to find the
 * corresponding MongoDB document by matching the invoiceNo or quoteNo.
 */
async function _resolveDocId(type, localId) {
  try {
    if (!localId) return null;

    // 1. Already looks like a MongoDB ObjectId (24 hex chars) → use as-is
    if (/^[0-9a-f]{24}$/i.test(localId)) return localId;

    // 2. Check ID map (populated on login and on every data load)
    const mapped = window._lfIdMap?.[localId];
    if (mapped && /^[0-9a-f]{24}$/i.test(mapped)) return mapped;

    // 3. Search localStorage for the item by its local id
    const lsKey  = type === 'invoice' ? 'lf2_invoices' : 'lf2_quotes';
    const lsItems = JSON.parse(localStorage.getItem(lsKey) || '[]');
    const lsItem  = lsItems.find(i => i.id === localId || i._id === localId);
    if (lsItem) {
      const mongoId = lsItem._id || lsItem.id;
      if (/^[0-9a-f]{24}$/i.test(mongoId)) return mongoId;
    }

    // 4. Search in-memory global arrays (most up-to-date source)
    const memArr = type === 'invoice' ? (window.invoices || []) : (window.quotes || []);
    const memItem = memArr.find(i => i.id === localId || i._id === localId);
    if (memItem) {
      const mongoId = memItem._id || memItem.id;
      if (/^[0-9a-f]{24}$/i.test(mongoId)) return mongoId;
    }

    // Nothing found — return original (backend will fail gracefully)
    console.warn('[resolveDocId] Could not resolve MongoDB ID for:', type, localId);
    return localId;
  } catch { return localId; }
}

// ── Override AI chat to use backend ─────────────────────────────────────────
// The original app has a local AI; we route to the API proxy instead.
const _origSendAI = window.sendAI;
window.sendAI = async function() {
  const inputEl = document.getElementById('aiInput');
  const outEl   = document.getElementById('aiOutput');
  if (!inputEl || !inputEl.value.trim()) return;

  const message = inputEl.value.trim();
  if (outEl) outEl.innerHTML = '<div style="color:#8b5cf6;padding:12px"><i class="fas fa-spinner fa-spin"></i> AI thinking...</div>';

  try {
    const reply = await window._bridgeAIChat(message);
    if (outEl) outEl.innerHTML = `<div style="white-space:pre-wrap;line-height:1.7;padding:12px">${reply}</div>`;
  } catch (e) {
    // Fallback to original local AI
    if (typeof _origSendAI === 'function') _origSendAI();
    else if (outEl) outEl.innerHTML = `<div style="color:red">${e.message}</div>`;
  }
};

// ── Add logout to topbar ──────────────────────────────────────────────────────
function _patchTopbarWithLogout() {
  const topbar = document.getElementById('topbar');
  if (!topbar || document.getElementById('logoutBtn')) return;

  const logoutBtn = document.createElement('button');
  logoutBtn.id = 'logoutBtn';
  logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Logout';
  logoutBtn.style.cssText = 'margin-left:12px;padding:7px 14px;background:#ef4444;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit';
  logoutBtn.onclick = async () => {
    if (!confirm('Log out?')) return;
    await API.logout();
    location.reload();
  };

  const rightArea = topbar.querySelector('.topbar-right') || topbar.lastElementChild;
  if (rightArea) rightArea.appendChild(logoutBtn);
  else topbar.appendChild(logoutBtn);
}

// ── Loading overlay ───────────────────────────────────────────────────────────
function _showLoadingOverlay(text) {
  if (document.getElementById('lfLoadingOverlay')) return;
  const el = document.createElement('div');
  el.id = 'lfLoadingOverlay';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(15,27,45,0.92);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:inherit';
  el.innerHTML = `
    <div style="font-size:48px;margin-bottom:20px;animation:pulse 1s infinite">☁️</div>
    <div style="font-size:20px;font-weight:700;margin-bottom:8px">LeadFlow Cloud</div>
    <div style="font-size:14px;color:#93c5fd;margin-bottom:24px">${text}</div>
    <div style="width:200px;height:4px;background:#334155;border-radius:4px;overflow:hidden">
      <div style="width:60%;height:100%;background:linear-gradient(90deg,#3b82f6,#8b5cf6);animation:slide 1.5s ease-in-out infinite"></div>
    </div>
    <style>
      @keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}
      @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
    </style>`;
  document.body.appendChild(el);
}

function _hideLoadingOverlay() {
  const el = document.getElementById('lfLoadingOverlay');
  if (el) el.remove();
}

// ── Register screen toggle ────────────────────────────────────────────────────
window.showRegisterScreen = function() {
  const loginBox = document.querySelector('.login-box');
  if (!loginBox) return;

  loginBox.innerHTML = `
    <div class="login-logo">🎯</div>
    <h1>LeadFlow OS</h1>
    <p class="tagline">CREATE YOUR FREE ACCOUNT</p>
    <input type="text" id="loginUser" placeholder="Your Name" autocomplete="name">
    <input type="email" id="regEmail" placeholder="Email Address" autocomplete="email">
    <input type="password" id="loginPass" placeholder="Password (min 8 chars)" autocomplete="new-password">
    <button id="loginBtn" onclick="doRegister()" style="background:linear-gradient(135deg,#10b981,#059669)">
      <i class="fas fa-user-plus"></i> Create Account
    </button>
    <div class="login-err" id="loginErr"></div>
    <div class="login-hint" style="margin-top:14px">
      <a href="#" onclick="showLoginScreen()" style="color:#93c5fd;text-decoration:none">← Back to Login</a>
    </div>`;
};

window.showLoginScreen = function() {
  const loginBox = document.querySelector('.login-box');
  if (!loginBox) return;

  loginBox.innerHTML = `
    <div class="login-logo">🎯</div>
    <h1>LeadFlow OS</h1>
    <p class="tagline">AUTOMATION-FIRST CRM · V3.0 CLOUD</p>
    <input type="email" id="loginUser" placeholder="Email Address" autocomplete="email">
    <input type="password" id="loginPass" placeholder="Password" autocomplete="current-password">
    <button id="loginBtn" onclick="doLogin()"><i class="fas fa-sign-in-alt"></i> Sign In</button>
    <div class="login-err" id="loginErr">Invalid credentials.</div>
    <div class="login-hint" style="margin-top:14px">
      No account? <a href="#" onclick="showRegisterScreen()" style="color:#93c5fd;text-decoration:none">Register free →</a>
    </div>`;
};

window.doRegister = async function() {
  const name     = document.getElementById('loginUser')?.value?.trim();
  const email    = document.getElementById('regEmail')?.value?.trim();
  const password = document.getElementById('loginPass')?.value?.trim();
  const errEl    = document.getElementById('loginErr');
  const btnEl    = document.getElementById('loginBtn');

  if (!name || !email || !password) {
    if (errEl) { errEl.textContent = 'All fields required'; errEl.style.display = 'block'; }
    return;
  }
  if (password.length < 8) {
    if (errEl) { errEl.textContent = 'Password must be at least 8 characters'; errEl.style.display = 'block'; }
    return;
  }

  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating account...'; }
  if (errEl) errEl.style.display = 'none';

  try {
    const data = await API.register(email, password, name);
    window.currentUser = data.user?.name || name;
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';
    const avatarEl = document.getElementById('topbarAvatar');
    if (avatarEl) avatarEl.textContent = window.currentUser[0].toUpperCase();
    _showLoadingOverlay('Setting up your account...');
    await window.bridgeLoadAllData();
    _hideLoadingOverlay();
    if (typeof init === 'function') init();
    if (typeof toast === 'function') toast('🎉 Welcome to LeadFlow Cloud, ' + window.currentUser + '!', 'success', 5000);
    _patchTopbarWithLogout();
  } catch (err) {
    if (errEl) { errEl.textContent = err.message || 'Registration failed'; errEl.style.display = 'block'; }
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '<i class="fas fa-user-plus"></i> Create Account'; }
  }
};

// ── Auto-login if already logged in ─────────────────────────────────────────
// On page refresh, the access token (memory-only) is gone.
// We MUST call restoreSession() first to use the httpOnly refresh cookie
// to silently get a new access token before checking isLoggedIn().
(async function autoLogin() {
  // Try to silently restore session from httpOnly cookie
  const restored = await API.restoreSession().catch(() => false);

  if (!API.isLoggedIn() && !restored) {
    window.location.href = '/';
    return;
  }

  const user = API.getUser();
  window.currentUser = user?.name || user?.email || 'User';

  const bootApp = async () => {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';
    const avatarEl = document.getElementById('topbarAvatar');
    if (avatarEl) avatarEl.textContent = window.currentUser[0].toUpperCase();

    _showLoadingOverlay('Loading your data from cloud...');
    await window.bridgeLoadAllData();
    _hideLoadingOverlay();

    if (typeof init === 'function') init();
    if (typeof toast === 'function') toast('Welcome back, ' + window.currentUser + '! ☁️', 'success');
    _patchTopbarWithLogout();

    // Check subscription status
    _checkSubscription();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootApp);
  } else {
    bootApp();
  }
})();

// ── Subscription: check status + show banner/paywall ────────────────────────
async function _checkSubscription() {
  try {
    const sub = await API.get('/subscription/status');
    window._currentSub = sub;

    if (!sub.isActive) {
      // EXPIRED — show paywall
      _showPaywall(sub);
      return;
    }

    // Show trial banner if within trial and expiring soon
    if (sub.plan === 'trial' && sub.daysRemaining <= 7) {
      _showTrialBanner(sub.daysRemaining);
    }

    // Show renewal warning if paid plan expiring in ≤ 5 days
    if (sub.plan !== 'trial' && sub.daysRemaining <= 5 && sub.daysRemaining > 0) {
      if (typeof toast === 'function') {
        toast(`⚠️ Your ${sub.plan} plan expires in ${sub.daysRemaining} day(s). Renew to avoid interruption.`, 'warning', 8000);
      }
    }
  } catch(e) {
    // 402 = subscription expired
    if (e.message?.includes('subscription_expired') || e.message?.includes('402')) {
      _showPaywall({ plan: 'expired' });
    }
    console.warn('[SaaS] Subscription check:', e.message);
  }
}

function _showTrialBanner(daysLeft) {
  if (document.getElementById('trialBanner')) return;
  const urgentColor = daysLeft <= 3 ? '#ef4444' : (daysLeft <= 7 ? '#f59e0b' : '#3b82f6');
  const banner = document.createElement('div');
  banner.id = 'trialBanner';
  banner.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:9999;background:${urgentColor};color:#fff;text-align:center;padding:10px 20px;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:16px;font-family:inherit`;
  banner.innerHTML = `
    <span>🎁 Free Trial: <strong>${daysLeft} day${daysLeft===1?'':'s'} remaining</strong> — Upgrade to keep all your data</span>
    <button onclick="_openUpgradeModal()" style="background:rgba(255,255,255,.2);border:1.5px solid rgba(255,255,255,.5);color:#fff;padding:5px 16px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit">Upgrade Now →</button>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:18px;padding:0 4px">×</button>`;
  document.body.prepend(banner);
  // Push app content down
  const app = document.getElementById('appContainer');
  if (app) app.style.marginTop = '44px';
}

function _showPaywall(sub) {
  // Build in-app paywall modal
  if (document.getElementById('lfPaywall')) return;
  const isTrialExpired = sub.plan === 'trial' || sub.plan === 'expired';
  const overlay = document.createElement('div');
  overlay.id = 'lfPaywall';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(6,11,20,.95);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);font-family:inherit';
  overlay.innerHTML = `
    <div style="background:#0d1526;border:1px solid #1e2d45;border-radius:24px;padding:48px 40px;width:100%;max-width:500px;text-align:center">
      <div style="font-size:56px;margin-bottom:16px">🔒</div>
      <h2 style="font-size:26px;font-weight:800;color:#f0f6ff;margin-bottom:12px">
        ${isTrialExpired ? 'Your Free Trial Has Ended' : 'Subscription Expired'}
      </h2>
      <p style="color:#7a92b0;font-size:15px;line-height:1.7;margin-bottom:32px">
        ${isTrialExpired
          ? 'Your 7-day free trial is over. Subscribe to continue using LeadFlow OS and keep all your data safe.'
          : 'Renew your subscription to regain full access to your leads, invoices, and data.'}
      </p>
      <div style="display:grid;gap:10px;margin-bottom:20px">
        <button onclick="_upgradeCheckout('quarterly')" style="width:100%;padding:16px;background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;border-radius:12px;color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit">
          🔥 ₹749 / Quarter — Most Popular
        </button>
        <button onclick="_upgradeCheckout('monthly')" style="width:100%;padding:13px;background:none;border:1.5px solid #1e2d45;border-radius:10px;color:#f0f6ff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">
          ₹299 / Month
        </button>
        <button onclick="_upgradeCheckout('yearly')" style="width:100%;padding:13px;background:linear-gradient(135deg,#10b981,#059669);border:none;border-radius:10px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">
          ₹2,900 / Year — Best Value
        </button>
      </div>
      <p style="font-size:12px;color:#7a92b0"><i>🔒 7-day money-back guarantee · Secure via Razorpay · GST invoice provided</i></p>
      <button onclick="document.getElementById('lfPaywall').style.display='none'" style="margin-top:16px;background:none;border:none;color:#7a92b0;font-size:12px;cursor:pointer;font-family:inherit">
        View app in read-only mode
      </button>
    </div>`;
  document.body.appendChild(overlay);
}

window._openUpgradeModal = function() { _showPaywall(window._currentSub || {}); }

window._upgradeCheckout = async function(plan) {
  try {
    const plansData = await API.get('/subscription/plans');
    const rzpKey    = plansData.razorpayKey;

    if (!rzpKey) {
      // No Razorpay configured — redirect to landing page pricing
      window.open('/landing.html#pricing', '_blank');
      return;
    }

    // Dynamically load Razorpay SDK if not present
    if (!window.Razorpay) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    const orderData = await API.post('/subscription/create-order', { plan });
    const user      = API.getUser();

    const options = {
      key:         rzpKey,
      amount:      orderData.amount,
      currency:    'INR',
      name:        'LeadFlow OS',
      description: orderData.label,
      order_id:    orderData.orderId,
      prefill: { email: user?.email || '' },
      theme:   { color: '#3b82f6' },
      handler: async function(response) {
        try {
          const result = await API.post('/subscription/verify', {
            razorpay_order_id:   response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature:  response.razorpay_signature,
            plan
          });
          // Remove paywall
          const pw = document.getElementById('lfPaywall');
          if (pw) pw.remove();
          const tb = document.getElementById('trialBanner');
          if (tb) tb.remove();
          if (typeof toast === 'function') toast('🎉 ' + result.message, 'success', 6000);
          window._currentSub = { plan, isActive: true, daysRemaining: result.months * 30 };
        } catch(e) {
          if (typeof toast === 'function') toast('Payment verification failed: ' + e.message, 'error');
        }
      }
    };
    new Razorpay(options).open();
  } catch(e) {
    if (typeof toast === 'function') toast('Error: ' + e.message, 'error');
    else alert('Error: ' + e.message);
  }
};

// Intercept API 402 responses globally (subscription expired mid-session)
const _origRequest = API._request.bind(API);
API._request = async function(method, path, body, retry) {
  try {
    return await _origRequest(method, path, body, retry);
  } catch(e) {
    if (e.message?.includes('subscription_expired') || e.message?.includes('subscription_required')) {
      _showPaywall({ plan: 'expired' });
    }
    throw e;
  }
};

console.log('[SaaS Patch] LeadFlow SaaS integration loaded ✅');

