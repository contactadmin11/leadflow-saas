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
const router     = express.Router();

router.use(protect);

/**
 * GET /api/sync
 * Pulls all user data from MongoDB to initialize the local Dexie DB on the frontend.
 * Resolves the issue where frontend creates string/timestamp IDs and needs the real ObjectIds.
 */
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const q = { userId, deletedAt: null };

    const [
      leads, contacts, clients, products,
      quotes, invoices, payments, activities,
      templates, rules, settings
    ] = await Promise.all([
      Lead.find(q).lean(),
      Contact.find(q).lean(),
      Client.find(q).lean(),
      Product.find(q).lean(),
      Quote.find(q).lean(),
      Invoice.find(q).lean(),
      Payment.find(q).lean(),
      Activity.find(q).lean(),
      Template.find(q).lean(),
      AutoRule.find(q).lean(),
      Settings.findOne({ userId }).lean()
    ]);

    res.json({
      leads,
      contacts,
      clients,
      products,
      quotes,
      invoices,
      payments,
      activities,
      templates,
      rules,
      settings: settings || {}
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
