/**
 * LeadFlow SaaS Data Bridge
 * ═══════════════════════════════════════════════════════════════
 * This bridge intercepts all localStorage reads/writes and
 * routes them through the backend API.
 *
 * Strategy:
 *   - On app start: fetch ALL data from API → populate memory arrays
 *     (same variable names: leads, clients, invoices, etc.)
 *   - On every LS.set() call: also POST/PUT to API
 *   - Result: Zero changes needed to the 5072-line main app!
 *
 * Load order in HTML:
 *   1. api.js          (API client)
 *   2. bridge.js       (this file — intercepts LS, wraps save functions)
 *   3. LeadFlow app JS (works unchanged, using API transparently)
 * ═══════════════════════════════════════════════════════════════
 */

(function() {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────
  let _bridgeReady = false;
  let _syncQueue   = [];

  // ── Debounce helper ──────────────────────────────────────────────────────
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ── Global array in memory map ───────────────────────────────────────────
  const GLOBAL_MAP = {
    'lf2_leads':      'leads',
    'lf2_contacts':   'contacts',
    'lf2_clients':    'clients',
    'lf2_products':   'products',
    'lf2_quotes':     'quotes',
    'lf2_invoices':   'invoices',
    'lf2_payments':   'payments',
    'lf2_activities': 'activities',
    'lf2_templates':  'templates',
    'lf2_rules':      'autoRules'
  };

  // ── UI render function map ───────────────────────────────────────────────
  const RENDER_MAP = {
    'lf2_leads':      'renderLeads',
    'lf2_contacts':   'renderContacts',
    'lf2_clients':    'renderClients',
    'lf2_products':   'renderProds',
    'lf2_quotes':     'renderQuotes',
    'lf2_invoices':   'renderInvoices',
    'lf2_payments':   'renderPmts',
    'lf2_activities': 'renderActs',
    'lf2_templates':  'renderTpls',
    'lf2_rules':      'renderAuto'
  };

  // Load persistent ID mapping from localStorage
  window._lfIdMap = {};
  try {
    window._lfIdMap = JSON.parse(localStorage.getItem('lf_id_map') || '{}');
  } catch {}

  // ── Key → API mapping ────────────────────────────────────────────────────
  const KEY_MAP = {
    'lf2_leads':      { get: () => API.getLeads(),       bulk: (d) => API.bulkLeads(d) },
    'lf2_contacts':   { get: () => API.getContacts() },
    'lf2_clients':    { get: () => API.getClients() },
    'lf2_products':   { get: () => API.getProducts() },
    'lf2_quotes':     { get: () => API.getQuotes() },
    'lf2_invoices':   { get: () => API.getInvoices() },
    'lf2_payments':   { get: () => API.getPayments() },
    'lf2_activities': { get: () => API.getActivities() },
    'lf2_templates':  { get: () => API.getTemplates() },
    'lf2_rules':      { get: () => API.getRules() },
    'lf2_settings':   { get: () => API.getSettings() },
  };

  // ── Individual save functions (called after original LS.set) ─────────────
  // These are debounced to avoid spamming the API on rapid updates.

  const SAVE_MAP = {
    'lf2_leads':      debounce(syncLeads,      500),
    'lf2_contacts':   debounce(syncContacts,   500),
    'lf2_clients':    debounce(syncClients,    500),
    'lf2_products':   debounce(syncProducts,   500),
    'lf2_quotes':     debounce(syncQuotes,     500),
    'lf2_invoices':   debounce(syncInvoices,   500),
    'lf2_payments':   debounce(syncPayments,   500),
    'lf2_activities': debounce(syncActivities, 500),
    'lf2_templates':  debounce(syncTemplates,  500),
    'lf2_rules':      debounce(syncRules,      500),
    'lf2_settings':   debounce(syncSettings,   800),
  };

  // ── Sync functions — smart diff, only send new/changed items ─────────────
  // We keep a local "last synced" snapshot to avoid full re-uploads.
  const _lastSynced = {};

  function getLocalArr(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }

  async function syncLeads() {
    if (!_bridgeReady) return;
    const items = getLocalArr('lf2_leads');
    await smartSync('lf2_leads', items, {
      create: (d) => API.createLead(d),
      update: (id, d) => API.updateLead(id, d),
      remove: (id) => API.deleteLead(id)
    });
  }

  async function syncContacts() {
    if (!_bridgeReady) return;
    await smartSync('lf2_contacts', getLocalArr('lf2_contacts'), {
      create: (d) => API.createContact(d),
      update: (id, d) => API.updateContact(id, d),
      remove: (id) => API.deleteContact(id)
    });
  }

  async function syncClients() {
    if (!_bridgeReady) return;
    await smartSync('lf2_clients', getLocalArr('lf2_clients'), {
      create: (d) => API.createClient(d),
      update: (id, d) => API.updateClient(id, d),
      remove: (id) => API.deleteClient(id)
    });
  }

  async function syncProducts() {
    if (!_bridgeReady) return;
    await smartSync('lf2_products', getLocalArr('lf2_products'), {
      create: (d) => API.createProduct(d),
      update: (id, d) => API.updateProduct(id, d),
      remove: (id) => API.deleteProduct(id)
    });
  }

  async function syncQuotes() {
    if (!_bridgeReady) return;
    await smartSync('lf2_quotes', getLocalArr('lf2_quotes'), {
      create: (d) => API.createQuote(d),
      update: (id, d) => API.updateQuote(id, d),
      remove: (id) => API.deleteQuote(id)
    });
  }

  async function syncInvoices() {
    if (!_bridgeReady) return;
    await smartSync('lf2_invoices', getLocalArr('lf2_invoices'), {
      create: (d) => API.createInvoice(d),
      update: (id, d) => API.updateInvoice(id, d),
      remove: (id) => API.deleteInvoice(id)
    });
  }

  async function syncPayments() {
    if (!_bridgeReady) return;
    await smartSync('lf2_payments', getLocalArr('lf2_payments'), {
      create: (d) => API.createPayment(d),
      update: null,
      remove: (id) => API.deletePayment(id)
    });
  }

  async function syncActivities() {
    if (!_bridgeReady) return;
    await smartSync('lf2_activities', getLocalArr('lf2_activities'), {
      create: (d) => API.createActivity(d),
      update: null,
      remove: (id) => API.deleteActivity(id)
    });
  }

  async function syncTemplates() {
    if (!_bridgeReady) return;
    await smartSync('lf2_templates', getLocalArr('lf2_templates'), {
      create: (d) => API.createTemplate(d),
      update: (id, d) => API.updateTemplate(id, d),
      remove: (id) => API.deleteTemplate(id)
    });
  }

  async function syncRules() {
    if (!_bridgeReady) return;
    await smartSync('lf2_rules', getLocalArr('lf2_rules'), {
      create: (d) => API.createRule(d),
      update: (id, d) => API.updateRule(id, d),
      remove: (id) => API.deleteRule(id)
    });
  }

  async function syncSettings() {
    if (!_bridgeReady) return;
    try {
      const s = JSON.parse(localStorage.getItem('lf2_settings') || '{}');
      await API.saveSettings(s);
    } catch(e) { console.warn('[Bridge] Settings sync failed:', e.message); }
  }

  /**
   * Smart sync: compare current items against last synced snapshot.
   * Only send API calls for items that were added, changed, or removed.
   */
  async function smartSync(key, currentItems, ops) {
    try {
      const prev = _lastSynced[key] || [];
      const prevMap = {};
      prev.forEach(p => { prevMap[p.id || p._id] = p; });

      const promises = [];

      for (const item of currentItems) {
        const id = item.id || item._id;
        const prevItem = prevMap[id];
        if (!prevItem) {
          // New item
          if (ops.create) {
            promises.push(
              ops.create(item)
                .then(res => {
                  // The server assigns the real MongoDB ObjectId.
                  // E.g., res might be { success: true, invoice: { _id: "...", ... } }
                  // Find the nested object that has the _id
                  const newObj = res._id ? res : Object.values(res).find(v => v && v._id);
                  if (newObj && newObj._id) {
                    const localId = id;
                    const mongoId = newObj._id;

                    // Record in ID map
                    window._lfIdMap = window._lfIdMap || {};
                    window._lfIdMap[localId] = mongoId;
                    localStorage.setItem('lf_id_map', JSON.stringify(window._lfIdMap));

                    item.id = mongoId; // Update local memory copy immediately
                    item._id = mongoId;

                    // Update global array in memory
                    const globalName = GLOBAL_MAP[key];
                    if (globalName && window[globalName]) {
                      const globArr = window[globalName];
                      const globItem = globArr.find(g => g.id === localId || g._id === localId);
                      if (globItem) {
                        globItem.id = mongoId;
                        globItem._id = mongoId;
                      }
                    }
                  }
                })
                .catch(e => console.warn('[Bridge] create failed:', e.message))
            );
          }
        } else if (JSON.stringify(item) !== JSON.stringify(prevItem)) {
          // Changed item
          if (ops.update && id) promises.push(ops.update(id, item).catch(e => console.warn('[Bridge] update failed:', e.message)));
        }
      }

      // Detect removed items
      const currentIds = new Set(currentItems.map(i => i.id || i._id));
      for (const p of prev) {
        const id = p.id || p._id;
        if (!currentIds.has(id)) {
          if (ops.remove && id) promises.push(ops.remove(id).catch(e => console.warn('[Bridge] delete failed:', e.message)));
        }
      }

      await Promise.allSettled(promises);
      
      // We must write the updated items (with real IDs) back to localStorage 
      // so the UI has the real IDs immediately for things like "Send WhatsApp".
      localStorage.setItem(key, JSON.stringify(currentItems));
      
      _lastSynced[key] = JSON.parse(JSON.stringify(currentItems));

      // Trigger UI re-render for the active section so the new ObjectIds are updated in the tables
      const renderFnName = RENDER_MAP[key];
      if (renderFnName && typeof window[renderFnName] === 'function') {
        try { window[renderFnName](); } catch(e) { console.warn('[Bridge] UI Re-render failed:', e.message); }
      }
    } catch(e) {
      console.warn('[Bridge] smartSync failed for', key, ':', e.message);
    }
  }

  // ── Intercept the original LS (localStorage wrapper) object ──────────────
  // The original app uses: LS.set(KEYS.leads, leads) and LS.get(KEYS.leads)
  // We wrap LS.set to also trigger API sync.
  function patchLS() {
    const origLS = window.LS;
    if (!origLS || typeof origLS.set !== 'function') {
      // LS not defined yet, wait a bit
      setTimeout(patchLS, 100);
      return;
    }

    const origSet = origLS.set.bind(origLS);
    origLS.set = function(key, value) {
      origSet(key, value); // Always write to localStorage first (keeps original behavior)
      // Then sync to API if we have a handler
      if (SAVE_MAP[key] && _bridgeReady) {
        SAVE_MAP[key]();
      }
    };
    console.log('[Bridge] LS.set intercepted ✅');
  }

  // ── Override send functions to use our API ────────────────────────────────
  // These replace the original WA/Email send functions with API-powered versions
  // that automatically attach PDFs.

  function patchSendFunctions() {
    // Override sendInvoiceWA (if it exists in the original app)
    window._bridgeSendInvoiceWA = async function(invoiceId, phone, message) {
      try {
        const result = await API.sendWA({ phone, message, docType: 'invoice', docId: invoiceId });
        if (result.success) {
          if (typeof toast === 'function') toast('✅ Invoice sent via WhatsApp with PDF!', 'success');
        } else {
          if (typeof toast === 'function') toast('❌ WA send failed: ' + (result.error || 'Unknown error'), 'error');
        }
        return result;
      } catch(e) {
        if (typeof toast === 'function') toast('❌ WA Error: ' + e.message, 'error');
        return { success: false, error: e.message };
      }
    };

    window._bridgeSendInvoiceEmail = async function(invoiceId, toEmail, toName, subject, message) {
      try {
        const result = await API.sendEmail({ toEmail, toName, subject, message, docType: 'invoice', docId: invoiceId });
        if (typeof toast === 'function') toast('✅ Invoice emailed with PDF!', 'success');
        return result;
      } catch(e) {
        if (typeof toast === 'function') toast('❌ Email Error: ' + e.message, 'error');
        return { success: false, error: e.message };
      }
    };

    window._bridgeSendBoth = async function(invoiceId, phone, toEmail, toName, subject, message) {
      try {
        const result = await API.sendBoth({ phone, toEmail, toName, subject, message, docType: 'invoice', docId: invoiceId });
        if (typeof toast === 'function') toast('✅ Invoice sent via WhatsApp + Email with PDF!', 'success');
        return result;
      } catch(e) {
        if (typeof toast === 'function') toast('❌ Send Error: ' + e.message, 'error');
        return { success: false, error: e.message };
      }
    };

    window._bridgeSendQuoteWA = async function(quoteId, phone, message) {
      try {
        const result = await API.sendWA({ phone, message, docType: 'quote', docId: quoteId });
        if (result.success) {
          if (typeof toast === 'function') toast('✅ Quote sent via WhatsApp with PDF!', 'success');
        }
        return result;
      } catch(e) {
        if (typeof toast === 'function') toast('❌ WA Error: ' + e.message, 'error');
        return { success: false, error: e.message };
      }
    };

    // WA Status check
    window._bridgeWAStatus = async function() {
      try {
        return await API.waStatus();
      } catch { return { status: 'error', ready: false }; }
    };

    // WA Init (get QR)
    window._bridgeWAInit = async function() {
      try {
        return await API.waInit();
      } catch(e) { return { status: 'error', error: e.message }; }
    };

    console.log('[Bridge] Send functions patched ✅');
  }

  // ── Load all data from API on startup ────────────────────────────────────
  window.bridgeLoadAllData = async function() {
    if (!API.isLoggedIn()) return;

    console.log('[Bridge] Loading all data from API...');

    try {
      const [
        leadsData, contactsData, clientsData, productsData,
        quotesData, invoicesData, paymentsData, activitiesData,
        templatesData, rulesData, settingsData
      ] = await Promise.allSettled([
        API.getLeads(),
        API.getContacts(),
        API.getClients(),
        API.getProducts(),
        API.getQuotes(),
        API.getInvoices(),
        API.getPayments(),
        API.getActivities(),
        API.getTemplates(),
        API.getRules(),
        API.getSettings()
      ]);

      const extract = (res, key) => {
        if (res.status === 'fulfilled') return res.value[key] || [];
        console.warn('[Bridge] Failed to load', key, ':', res.reason?.message);
        return [];
      };

      const extractObj = (res, key) => {
        if (res.status === 'fulfilled') return res.value[key] || {};
        return {};
      };

      // Map MongoDB _id to id (for compatibility with original app)
      const mapId = (arr) => arr.map(item => ({
        ...item,
        id: item.id || item._id
      }));

      // Safe merge list function: merges database items with local items,
      // keeping any local items that haven't been synced to the database yet.
      const mergeLists = (localKey, dbList) => {
        const local = getLocalArr(localKey);
        const merged = [...dbList];
        const dbIds = new Set(dbList.map(item => String(item.id || item._id)));
        for (const localItem of local) {
          const id = localItem.id || localItem._id;
          if (id && !dbIds.has(String(id))) {
            merged.push(localItem);
          }
        }
        return merged;
      };

      const leads      = mergeLists('lf2_leads',      mapId(extract(leadsData,     'leads')));
      const contacts   = mergeLists('lf2_contacts',   mapId(extract(contactsData,  'contacts')));
      const clients    = mergeLists('lf2_clients',    mapId(extract(clientsData,   'clients')));
      const products   = mergeLists('lf2_products',   mapId(extract(productsData,  'products')));
      const quotes     = mergeLists('lf2_quotes',     mapId(extract(quotesData,    'quotes')));
      const invoices   = mergeLists('lf2_invoices',   mapId(extract(invoicesData,  'invoices')));
      const payments   = mergeLists('lf2_payments',   mapId(extract(paymentsData,  'payments')));
      const activities = mergeLists('lf2_activities', mapId(extract(activitiesData,'activities')));
      const templates  = mergeLists('lf2_templates',  mapId(extract(templatesData, 'templates')));
      const rules      = mergeLists('lf2_rules',      mapId(extract(rulesData,     'rules')));
      const settings   = extractObj(settingsData,     'settings');

      localStorage.setItem('lf2_leads',      JSON.stringify(leads));
      localStorage.setItem('lf2_contacts',   JSON.stringify(contacts));
      localStorage.setItem('lf2_clients',    JSON.stringify(clients));
      localStorage.setItem('lf2_products',   JSON.stringify(products));
      localStorage.setItem('lf2_quotes',     JSON.stringify(quotes));
      localStorage.setItem('lf2_invoices',   JSON.stringify(invoices));
      localStorage.setItem('lf2_payments',   JSON.stringify(payments));
      localStorage.setItem('lf2_activities', JSON.stringify(activities));
      localStorage.setItem('lf2_templates',  JSON.stringify(templates));
      localStorage.setItem('lf2_rules',      JSON.stringify(rules));
      if (settings && Object.keys(settings).length) {
        localStorage.setItem('lf2_settings', JSON.stringify(settings));
      }

      // Store last synced snapshots
      _lastSynced['lf2_leads']      = JSON.parse(JSON.stringify(leads));
      _lastSynced['lf2_contacts']   = JSON.parse(JSON.stringify(contacts));
      _lastSynced['lf2_clients']    = JSON.parse(JSON.stringify(clients));
      _lastSynced['lf2_products']   = JSON.parse(JSON.stringify(products));
      _lastSynced['lf2_quotes']     = JSON.parse(JSON.stringify(quotes));
      _lastSynced['lf2_invoices']   = JSON.parse(JSON.stringify(invoices));
      _lastSynced['lf2_payments']   = JSON.parse(JSON.stringify(payments));
      _lastSynced['lf2_activities'] = JSON.parse(JSON.stringify(activities));
      _lastSynced['lf2_templates']  = JSON.parse(JSON.stringify(templates));
      _lastSynced['lf2_rules']      = JSON.parse(JSON.stringify(rules));

      _bridgeReady = true;
      console.log(`[Bridge] ✅ Loaded: ${leads.length} leads, ${clients.length} clients, ${invoices.length} invoices, ${quotes.length} quotes`);

      // ── Populate _lfIdMap so _resolveDocId always works ──
      // This ensures WhatsApp/Email PDF attachment works even after page refresh
      window._lfIdMap = window._lfIdMap || {};
      [...invoices, ...quotes, ...leads, ...clients, ...contacts].forEach(item => {
        if (item._id && item.id && item._id !== item.id) {
          window._lfIdMap[item.id] = item._id;   // localId → mongoId
        }
        // Also map by invoiceNo/quoteNo for extra reliability
        if (item._id && (item.invoiceNo || item.quoteNo)) {
          const docNo = item.invoiceNo || item.quoteNo;
          window._lfIdMap[docNo] = item._id;
        }
      });
      localStorage.setItem('lf_id_map', JSON.stringify(window._lfIdMap));

      return { leads, contacts, clients, products, quotes, invoices, payments, activities, templates, rules, settings };
    } catch(e) {
      console.error('[Bridge] Failed to load data:', e);
      _bridgeReady = true; // Still mark ready so local operations work
      return null;
    }
  };

  // ── AI Chat bridge ───────────────────────────────────────────────────────
  window._bridgeAIChat = async function(message, context) {
    try {
      const result = await API.aiChat(message, context);
      return result.reply || 'No response';
    } catch(e) {
      return 'AI Error: ' + e.message;
    }
  };

  // ── Initialize ────────────────────────────────────────────────────────────
  function init() {
    patchSendFunctions();
    // Wait for the LS object to be defined by the original app
    setTimeout(patchLS, 200);
    console.log('[Bridge] LeadFlow API Bridge initialized ✅');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose bridge status for debugging
  window._bridgeStatus = () => ({
    ready: _bridgeReady,
    loggedIn: API.isLoggedIn(),
    user: API.getUser()
  });

})();
