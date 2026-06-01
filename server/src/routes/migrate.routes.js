/**
 * Migration route — import localStorage JSON data into MongoDB.
 * Allows users to migrate from the old single-HTML-file app.
 */
const express    = require('express');
const Lead       = require('../models/Lead');
const Contact    = require('../models/Contact');
const Client     = require('../models/Client');
const Product    = require('../models/Product');
const Quote      = require('../models/Quote');
const Invoice    = require('../models/Invoice');
const Payment    = require('../models/Payment');
const Activity   = require('../models/Activity');
const Template   = require('../models/Template');
const AutoRule   = require('../models/AutoRule');
const Settings   = require('../models/Settings');
const { protect }= require('../middleware/auth');
const { encrypt }= require('../services/crypto.service');
const router     = express.Router();

router.use(protect);

/**
 * POST /api/migrate/import
 * Accepts the full JSON export from the old LeadFlow app.
 * Merges all data into the authenticated user's account.
 */
router.post('/import', async (req, res, next) => {
  try {
    const data    = req.body;
    const userId  = req.user.id;
    const summary = {};

    const toId = (obj) => { const o = { ...obj }; delete o.id; delete o._id; return { ...o, userId }; };

    if (Array.isArray(data.leads) && data.leads.length) {
      const docs = data.leads.map(l => ({ ...toId(l), stage: l.stage || 'New' }));
      const r = await Lead.insertMany(docs, { ordered: false }).catch(() => ({ length: 0 }));
      summary.leads = r.length || docs.length;
    }
    if (Array.isArray(data.contacts) && data.contacts.length) {
      const docs = data.contacts.map(toId);
      await Contact.insertMany(docs, { ordered: false }).catch(() => {});
      summary.contacts = docs.length;
    }
    if (Array.isArray(data.clients) && data.clients.length) {
      const docs = data.clients.map(toId);
      await Client.insertMany(docs, { ordered: false }).catch(() => {});
      summary.clients = docs.length;
    }
    if (Array.isArray(data.products) && data.products.length) {
      const docs = data.products.map(toId);
      await Product.insertMany(docs, { ordered: false }).catch(() => {});
      summary.products = docs.length;
    }
    if (Array.isArray(data.quotes) && data.quotes.length) {
      const docs = data.quotes.map(q => ({ ...toId(q), items: q.items||[], total: q.total||0 }));
      await Quote.insertMany(docs, { ordered: false }).catch(() => {});
      summary.quotes = docs.length;
    }
    if (Array.isArray(data.invoices) && data.invoices.length) {
      const docs = data.invoices.map(i => ({ ...toId(i), items: i.items||[], total: i.total||0 }));
      await Invoice.insertMany(docs, { ordered: false }).catch(() => {});
      summary.invoices = docs.length;
    }
    if (Array.isArray(data.payments) && data.payments.length) {
      const docs = data.payments.map(toId);
      await Payment.insertMany(docs, { ordered: false }).catch(() => {});
      summary.payments = docs.length;
    }
    if (Array.isArray(data.activities) && data.activities.length) {
      const docs = data.activities.map(a => ({ ...toId(a), notes: a.notes || 'Migrated activity' }));
      await Activity.insertMany(docs, { ordered: false }).catch(() => {});
      summary.activities = docs.length;
    }
    if (Array.isArray(data.templates) && data.templates.length) {
      const docs = data.templates.map(toId);
      await Template.insertMany(docs, { ordered: false }).catch(() => {});
      summary.templates = docs.length;
    }

    // Migrate settings
    if (data.settings) {
      const s = data.settings;
      const upd = {};
      if (s.bizName)    upd.bizName   = s.bizName;
      if (s.userName)   upd.userName  = s.userName;
      if (s.email)      upd.email     = s.email;
      if (s.phone)      upd.phone     = s.phone;
      if (s.address)    upd.address   = s.address;
      if (s.gstin)      upd.gstin     = s.gstin;
      if (s.pan)        upd.pan       = s.pan;
      if (s.state)      upd.state     = s.state;
      if (s.invPrefix)  upd.invPrefix = s.invPrefix;
      if (s.currency)   upd.currency  = s.currency;
      if (s.upiId)      upd.upiId     = s.upiId;
      if (s.team)       upd.team      = s.team;
      if (s.sources)    upd.sources   = s.sources;
      if (s.gmailUser)  upd.gmailUserEnc = encrypt(s.gmailUser);
      if (s.gmailPass)  upd.gmailPassEnc = encrypt(s.gmailPass);
      await Settings.findOneAndUpdate({ userId }, { $set: upd }, { upsert: true });
      summary.settings = true;
    }

    res.json({ success: true, summary, message: `Migration complete! Imported: ${Object.entries(summary).map(([k,v])=>k+':'+v).join(', ')}` });
  } catch (err) { next(err); }
});

module.exports = router;
