const express    = require('express');
const Client     = require('../models/Client');
const Onboarding = require('../models/Onboarding');
const { protect }= require('../middleware/auth');
const { audit }  = require('../services/audit.service');
const router     = express.Router();
router.use(protect);
const q = (uid, ex = {}) => ({ userId: uid, deletedAt: null, ...ex });
router.get('/', async (req, res, next) => {
  try {
    const { search, industry } = req.query;
    const filter = q(req.user.id);
    if (industry) filter.industry = industry;
    if (search) { const rx = new RegExp(search, 'i'); filter.$or = [{ name: rx }, { company: rx }, { email: rx }, { gstin: rx }]; }
    const clients = await Client.find(filter).sort('-createdAt').lean();
    res.json({ clients });
  } catch (err) { next(err); }
});
router.get('/:id', async (req, res, next) => {
  try {
    const client = await Client.findOne(q(req.user.id, { _id: req.params.id })).lean();
    if (!client) return res.status(404).json({ error: 'Not found' });
    res.json({ client });
  } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try {
    const data = { ...req.body, userId: req.user.id }; delete data._id;
    const client = await Client.create(data);
    // Auto-create onboarding
    const exists = await Onboarding.findOne({ userId: req.user.id, clientId: client._id });
    if (!exists) {
      await Onboarding.create({
        userId: req.user.id, clientId: client._id,
        checklist: [
          { id: 'docs', label: 'Collect business documents (PAN, GSTIN, MOA)', done: false },
          { id: 'agreement', label: 'Sign engagement letter / service agreement', done: false },
          { id: 'access', label: 'Get portal / software access credentials', done: false },
          { id: 'bank', label: 'Collect bank account details', done: false },
          { id: 'intro', label: 'Intro call / onboarding meeting done', done: false },
          { id: 'setup', label: 'Complete initial setup in system', done: false }
        ],
        progress: 0
      });
    }
    await audit({ userId: req.user.id, action: 'CLIENT_CREATED', resource: 'Client', resourceId: client._id, req });
    res.status(201).json({ client });
  } catch (err) { next(err); }
});
router.put('/:id', async (req, res, next) => {
  try {
    const update = { ...req.body }; delete update._id; delete update.userId;
    const client = await Client.findOneAndUpdate(q(req.user.id, { _id: req.params.id }), { $set: update }, { new: true });
    if (!client) return res.status(404).json({ error: 'Not found' });
    res.json({ client });
  } catch (err) { next(err); }
});
router.delete('/:id', async (req, res, next) => {
  try { await Client.findOneAndUpdate(q(req.user.id, { _id: req.params.id }), { $set: { deletedAt: new Date() } }); res.json({ success: true }); }
  catch (err) { next(err); }
});
module.exports = router;
