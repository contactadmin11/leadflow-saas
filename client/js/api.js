/**
 * LeadFlow API Client — Secure Edition
 * ══════════════════════════════════════════════════════════════
 * Security improvements over basic version:
 *
 * 1. ACCESS TOKEN in MEMORY only (never localStorage)
 *    → Stolen localStorage = no access token = useless
 *
 * 2. REFRESH TOKEN in httpOnly Cookie (set by server)
 *    → Cannot be read by any JavaScript (XSS-proof)
 *    → Automatically sent by browser on /api/auth/refresh
 *
 * 3. DEVICE FINGERPRINT sent on every request (X-Device-ID)
 *    → Server validates this matches the registered device
 *    → If fingerprint mismatch → 403 Device Not Authorized
 *
 * 4. On page refresh → auto-restore session from cookie
 *    → No login screen if refresh cookie is still valid
 * ══════════════════════════════════════════════════════════════
 */

const API_BASE = window.LEADFLOW_API_URL || (window.location.origin + '/api');

// ── Access token in MEMORY only (lost on tab close = fine, refreshed on load) ──
let _accessToken = null;

// ── User object in memory (restored from refresh on page load) ──
let _currentUser = null;

// ── Device fingerprint (async, loaded on init) ──
let _deviceFingerprint = null;
let _deviceName        = null;

// Initialize device fingerprint as early as possible
(async function initDevice() {
  try {
    if (window.LeadFlowDevice) {
      _deviceFingerprint = await window.LeadFlowDevice.getFingerprint();
      _deviceName        = window.LeadFlowDevice.getDeviceName();
    }
  } catch (e) { console.warn('[API] Device init:', e); }
})();

const API = {

  // ── Base URL (read-only) ───────────────────────────────────────────────────
  get baseUrl() { return API_BASE; },

  // ── Token management (memory only) ────────────────────────────────────────
  setAccessToken(token) {
    _accessToken = token;
  },

  clearSession() {
    _accessToken = null;
    _currentUser = null;
    // Note: httpOnly refresh cookie is cleared by server on logout
  },

  getUser() {
    return _currentUser;
  },

  setUser(user) {
    _currentUser = user;
  },

  isLoggedIn() {
    return !!_accessToken && !!_currentUser;
  },

  // ── Core request method ────────────────────────────────────────────────────
  async _request(method, path, body, retry = true) {
    // Ensure we have a device fingerprint
    if (!_deviceFingerprint && window.LeadFlowDevice) {
      _deviceFingerprint = await window.LeadFlowDevice.getFingerprint().catch(() => null);
      _deviceName        = window.LeadFlowDevice.getDeviceName();
    }

    const headers = { 'Content-Type': 'application/json' };
    if (_accessToken)       headers['Authorization']  = `Bearer ${_accessToken}`;
    if (_deviceFingerprint) headers['X-Device-ID']     = _deviceFingerprint;
    if (_deviceName)        headers['X-Device-Name']   = _deviceName;
    if (window.LEADFLOW_APP_SECRET) headers['X-App-Secret'] = window.LEADFLOW_APP_SECRET;

    const opts = {
      method,
      headers,
      credentials: 'include',  // ← sends httpOnly refresh cookie automatically
    };
    if (body) opts.body = JSON.stringify(body);

    const resp = await fetch(`${API_BASE}${path}`, opts);

    // Token expired → try refresh
    if (resp.status === 401 && retry) {
      const refreshed = await this._refresh();
      if (refreshed) return this._request(method, path, body, false);
      else {
        this.clearSession();
        // Redirect to landing page
        window.location.href = '/';
        return;
      }
    }

    // Device not authorized
    if (resp.status === 403) {
      const data = await resp.json().catch(() => ({}));
      if (data.code === 'DEVICE_NOT_AUTHORIZED') {
        this.clearSession();
        _showDeviceBlockedScreen(data.message);
        throw new Error(data.message || 'Device not authorized');
      }
    }

    const data = await resp.json().catch(() => ({ error: 'Server error' }));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  },

  // ── Refresh access token using httpOnly cookie ─────────────────────────────
  // Browser automatically sends the refresh cookie — no manual token needed
  async _refresh() {
    try {
      const resp = await fetch(`${API_BASE}/auth/refresh`, {
        method:      'POST',
        headers:     {
          'Content-Type': 'application/json',
          ..._deviceFingerprint ? { 'X-Device-ID': _deviceFingerprint } : {}
        },
        credentials: 'include',  // sends httpOnly cookie
        body:        JSON.stringify({})  // empty body — server reads cookie
      });
      if (!resp.ok) return false;
      const { accessToken, user } = await resp.json();
      this.setAccessToken(accessToken);
      if (user) this.setUser(user);
      return true;
    } catch { return false; }
  },

  // ── Auto-restore session on page load ─────────────────────────────────────
  // Called once on startup — uses httpOnly cookie to get a fresh access token
  async restoreSession() {
    try {
      const resp = await fetch(`${API_BASE}/auth/refresh`, {
        method:      'POST',
        headers:     {
          'Content-Type': 'application/json',
          ...(await window.LeadFlowDevice?.getFingerprint().catch(() => null)
              ? { 'X-Device-ID': await window.LeadFlowDevice.getFingerprint() }
              : {})
        },
        credentials: 'include',
        body:        JSON.stringify({})
      });
      if (!resp.ok) return false;
      const { accessToken, user } = await resp.json();
      this.setAccessToken(accessToken);
      if (user) this.setUser(user);
      return true;
    } catch { return false; }
  },

  // ── Convenience methods ───────────────────────────────────────────────────
  get:    (path)       => API._request('GET',    path),
  post:   (path, body) => API._request('POST',   path, body),
  put:    (path, body) => API._request('PUT',    path, body),
  delete: (path)       => API._request('DELETE', path),

  // ── Auth ──────────────────────────────────────────────────────────────────
  async login(email, password) {
    const fp   = _deviceFingerprint || (await window.LeadFlowDevice?.getFingerprint().catch(() => null));
    const name = _deviceName || window.LeadFlowDevice?.getDeviceName() || 'Browser';
    const info = window.LeadFlowDevice?.getDeviceInfo() || {};

    const resp = await fetch(`${API_BASE}/auth/login`, {
      method:      'POST',
      headers:     {
        'Content-Type': 'application/json',
        ...(fp   ? { 'X-Device-ID':   fp   } : {}),
        ...(name ? { 'X-Device-Name': name } : {}),
        ...(window.LEADFLOW_APP_SECRET ? { 'X-App-Secret': window.LEADFLOW_APP_SECRET } : {})
      },
      credentials: 'include',  // receive httpOnly cookie
      body:        JSON.stringify({ email, password, deviceInfo: info })
    });

    const data = await resp.json().catch(() => ({ error: 'Server error' }));

    // Device blocked
    if (resp.status === 403 && data.code === 'DEVICE_LIMIT_REACHED') {
      _showDeviceLimitScreen(data);
      throw new Error(data.message);
    }

    if (!resp.ok) throw new Error(data.error || `Login failed`);

    this.setAccessToken(data.accessToken);
    this.setUser(data.user);
    return data;
  },

  async register(email, password, name) {
    const fp  = _deviceFingerprint || (await window.LeadFlowDevice?.getFingerprint().catch(() => null));
    const dn  = _deviceName || window.LeadFlowDevice?.getDeviceName() || 'Browser';
    const info = window.LeadFlowDevice?.getDeviceInfo() || {};

    const resp = await fetch(`${API_BASE}/auth/register`, {
      method:      'POST',
      headers:     {
        'Content-Type': 'application/json',
        ...(fp ? { 'X-Device-ID': fp, 'X-Device-Name': dn } : {}),
        ...(window.LEADFLOW_APP_SECRET ? { 'X-App-Secret': window.LEADFLOW_APP_SECRET } : {})
      },
      credentials: 'include',
      body:        JSON.stringify({ email, password, name, deviceInfo: info })
    });

    const data = await resp.json().catch(() => ({ error: 'Server error' }));
    if (!resp.ok) throw new Error(data.error || 'Registration failed');

    this.setAccessToken(data.accessToken);
    this.setUser(data.user);
    return data;
  },

  async logout() {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json',
          ..._accessToken ? { 'Authorization': `Bearer ${_accessToken}` } : {} },
        credentials: 'include',  // server will clear cookie
        body:        JSON.stringify({})
      });
    } catch {}
    this.clearSession();
  },

  // ── Leads ─────────────────────────────────────────────────────────────────
  getLeads:    (p)   => API.get('/leads' + (p ? '?'+new URLSearchParams(p) : '')),
  getLead:     (id)  => API.get(`/leads/${id}`),
  createLead:  (d)   => API.post('/leads', d),
  updateLead:  (id,d)=> API.put(`/leads/${id}`, d),
  deleteLead:  (id)  => API.delete(`/leads/${id}`),
  bulkLeads:   (leads) => API.post('/leads/bulk', { leads }),

  // ── Contacts ──────────────────────────────────────────────────────────────
  getContacts:   (p)   => API.get('/contacts' + (p ? '?'+new URLSearchParams(p) : '')),
  createContact: (d)   => API.post('/contacts', d),
  updateContact: (id,d)=> API.put(`/contacts/${id}`, d),
  deleteContact: (id)  => API.delete(`/contacts/${id}`),

  // ── Clients ───────────────────────────────────────────────────────────────
  getClients:   (p)   => API.get('/clients' + (p ? '?'+new URLSearchParams(p) : '')),
  getClient:    (id)  => API.get(`/clients/${id}`),
  createClient: (d)   => API.post('/clients', d),
  updateClient: (id,d)=> API.put(`/clients/${id}`, d),
  deleteClient: (id)  => API.delete(`/clients/${id}`),

  // ── Products ──────────────────────────────────────────────────────────────
  getProducts:   ()    => API.get('/products'),
  createProduct: (d)   => API.post('/products', d),
  updateProduct: (id,d)=> API.put(`/products/${id}`, d),
  deleteProduct: (id)  => API.delete(`/products/${id}`),

  // ── Quotes ────────────────────────────────────────────────────────────────
  getQuotes:   ()     => API.get('/quotes'),
  getQuote:    (id)   => API.get(`/quotes/${id}`),
  createQuote: (d)    => API.post('/quotes', d),
  updateQuote: (id,d) => API.put(`/quotes/${id}`, d),
  deleteQuote: (id)   => API.delete(`/quotes/${id}`),
  getQuotePDF: (id)   => `${API_BASE}/quotes/${id}/pdf?token=${_accessToken}`,

  // ── Invoices ──────────────────────────────────────────────────────────────
  getInvoices:        (p)   => API.get('/invoices' + (p ? '?'+new URLSearchParams(p) : '')),
  getInvoice:         (id)  => API.get(`/invoices/${id}`),
  createInvoice:      (d)   => API.post('/invoices', d),
  updateInvoice:      (id,d)=> API.put(`/invoices/${id}`, d),
  deleteInvoice:      (id)  => API.delete(`/invoices/${id}`),
  getInvoicePDF:      (id)  => `${API_BASE}/invoices/${id}/pdf?token=${_accessToken}`,
  getInvoicePDFBase64:(id)  => API.post(`/invoices/${id}/pdf-base64`),

  // ── Payments ──────────────────────────────────────────────────────────────
  getPayments:   ()    => API.get('/payments'),
  createPayment: (d)   => API.post('/payments', d),
  deletePayment: (id)  => API.delete(`/payments/${id}`),

  // ── Activities ────────────────────────────────────────────────────────────
  getActivities:  (p)  => API.get('/activities' + (p ? '?'+new URLSearchParams(p) : '')),
  createActivity: (d)  => API.post('/activities', d),
  deleteActivity: (id) => API.delete(`/activities/${id}`),

  // ── Templates ─────────────────────────────────────────────────────────────
  getTemplates:   (p)   => API.get('/templates' + (p ? '?'+new URLSearchParams(p) : '')),
  createTemplate: (d)   => API.post('/templates', d),
  updateTemplate: (id,d)=> API.put(`/templates/${id}`, d),
  deleteTemplate: (id)  => API.delete(`/templates/${id}`),

  // ── Automation ────────────────────────────────────────────────────────────
  getRules:   ()     => API.get('/automation'),
  createRule: (d)    => API.post('/automation', d),
  updateRule: (id,d) => API.put(`/automation/${id}`, d),
  deleteRule: (id)   => API.delete(`/automation/${id}`),

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings:  ()  => API.get('/settings'),
  saveSettings: (d) => API.put('/settings', d),
  testEmail:    ()  => API.post('/settings/test-email'),

  // ── Reports ───────────────────────────────────────────────────────────────
  getReports: () => API.get('/reports'),

  // ── AI ────────────────────────────────────────────────────────────────────
  aiChat: (message, context) => API.post('/ai/chat', { message, context }),

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  waStatus:     ()  => API.get('/wa/status'),
  waInit:       ()  => API.post('/wa/init'),
  waDisconnect: ()  => API.post('/wa/disconnect'),

  // ── Messenger ─────────────────────────────────────────────────────────────
  sendWA:    (d) => API.post('/send/whatsapp', d),
  sendEmail: (d) => API.post('/send/email', d),
  sendBoth:  (d) => API.post('/send/both', d),
  sendBulk:  (d) => API.post('/send/bulk', d),

  // ── Subscription ──────────────────────────────────────────────────────────
  getSubStatus:      ()      => API.get('/subscription/status'),
  getSubPlans:       ()      => API.get('/subscription/plans'),
  createOrder:       (plan)  => API.post('/subscription/create-order', { plan }),
  verifyPayment:     (d)     => API.post('/subscription/verify', d),
  getBilling:        ()      => API.get('/subscription/billing'),
  getMyDevices:      ()      => API.get('/subscription/devices'),
  removeMyDevice:    (id)    => API.delete(`/subscription/devices/${id}`),

  // ── Migration ─────────────────────────────────────────────────────────────
  migrateImport: (data) => API.post('/migrate/import', data),

  // ── Admin ─────────────────────────────────────────────────────────────────
  adminLogin:          (pwd)    => API.post('/admin/login', { password: pwd }),
  adminDashboard:      ()       => API._request('GET', '/admin/dashboard'),
  adminGetUsers:       ()       => API._request('GET', '/admin/users'),
  adminGetAuditLogs:   ()       => API._request('GET', '/admin/audit-logs'),
  // Device management (admin)
  adminGetUserDevices: (uid)    => API._request('GET',    `/admin/users/${uid}/devices`),
  adminRevokeDevice:   (uid,sid)=> API._request('DELETE', `/admin/users/${uid}/devices/${sid}`),
  adminRevokeAllDevices:(uid)   => API._request('DELETE', `/admin/users/${uid}/devices`),
  adminSetMaxDevices:  (uid,n)  => API._request('PUT',    `/admin/users/${uid}/max-devices`, { maxDevices: n }),
};

// ── Device blocked screens ─────────────────────────────────────────────────
function _showDeviceLimitScreen(data) {
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#060b14;font-family:Inter,sans-serif">
      <div style="background:#0d1526;border:1px solid #ef4444;border-radius:24px;padding:48px;max-width:480px;text-align:center;color:#f0f6ff">
        <div style="font-size:56px;margin-bottom:16px">🔒</div>
        <h2 style="font-size:24px;font-weight:800;margin-bottom:12px;color:#f87171">Device Limit Reached</h2>
        <p style="color:#7a92b0;line-height:1.7;margin-bottom:24px">${data.message || 'This account is already active on another device. Contact the account owner or admin to reset the device.'}</p>
        ${data.devices ? `
        <div style="background:#111c30;border-radius:12px;padding:16px;margin-bottom:24px;text-align:left">
          <div style="font-size:12px;color:#7a92b0;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Active Devices</div>
          ${data.devices.map(d => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #1e2d45">
              <span>💻</span>
              <div>
                <div style="font-size:14px;font-weight:600">${d.deviceName}</div>
                <div style="font-size:12px;color:#7a92b0">${d.ip} · Last seen ${new Date(d.lastSeen).toLocaleDateString()}</div>
              </div>
            </div>`).join('')}
        </div>` : ''}
        <button onclick="window.location.href='/'" style="padding:12px 28px;background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;border-radius:10px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">
          Go to Login Page
        </button>
        <p style="margin-top:16px;font-size:12px;color:#7a92b0">Contact your admin to reset your device access</p>
      </div>
    </div>`;
}

function _showDeviceBlockedScreen(message) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(6,11,20,.97);z-index:999999;display:flex;align-items:center;justify-content:center;font-family:inherit';
  overlay.innerHTML = `
    <div style="background:#0d1526;border:1px solid #ef4444;border-radius:24px;padding:48px;max-width:440px;text-align:center;color:#f0f6ff">
      <div style="font-size:48px;margin-bottom:16px">⛔</div>
      <h2 style="font-size:22px;font-weight:800;color:#f87171;margin-bottom:12px">Device Not Authorized</h2>
      <p style="color:#7a92b0;line-height:1.7;margin-bottom:24px">${message || 'This device is not authorized for your account. Please login again or contact your admin.'}</p>
      <button onclick="window.location.href='/'" style="padding:12px 28px;background:#ef4444;border:none;border-radius:10px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">
        Sign Out & Go to Login
      </button>
    </div>`;
  document.body.appendChild(overlay);
}

window.API = API;
