const express    = require('express');
const { body }   = require('express-validator');
const Lead       = require('../models/Lead');
const Contact    = require('../models/Contact');
const { protect }= require('../middleware/auth');
const { validate }= require('../middleware/validate');
const { audit }  = require('../services/audit.service');
const router     = express.Router();

router.use(protect);

const q = (userId, extra = {}) => ({ userId, deletedAt: null, ...extra });

// GET all leads
router.get('/', async (req, res, next) => {
  try {
    const { stage, source, assignedTo, search, sort = '-createdAt', limit = 500 } = req.query;
    const filter = q(req.user.id);
    if (stage)      filter.stage      = stage;
    if (source)     filter.source     = source;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (search) {
      const rx = new RegExp(search, 'i');
      filter.$or = [{ name: rx }, { company: rx }, { email: rx }, { phone: rx }, { tags: rx }];
    }
    const leads = await Lead.find(filter).sort(sort).limit(Number(limit)).lean();
    res.json({ leads });
  } catch (err) { next(err); }
});

// GET one lead
router.get('/:id', async (req, res, next) => {
  try {
    const lead = await Lead.findOne(q(req.user.id, { _id: req.params.id })).lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ lead });
  } catch (err) { next(err); }
});

// POST create lead
router.post('/',
  [ body('name').trim().notEmpty().withMessage('Name is required') ],
  validate,
  async (req, res, next) => {
    try {
      const data = { ...req.body, userId: req.user.id };
      delete data._id;
      const lead = await Lead.create(data);
      // Auto-create contact
      if (lead.email || lead.phone) {
        const exists = await Contact.findOne({ userId: req.user.id, email: lead.email, deletedAt: null });
        if (!exists) {
          await Contact.create({ userId: req.user.id, leadId: lead._id, name: lead.name, company: lead.company, email: lead.email, phone: lead.phone, position: lead.position, city: lead.city });
        }
      }
      await audit({ userId: req.user.id, action: 'LEAD_CREATED', resource: 'Lead', resourceId: lead._id, req });
      res.status(201).json({ lead });
    } catch (err) { next(err); }
  }
);

// PUT update lead
router.put('/:id',
  [ body('name').optional().trim().notEmpty() ],
  validate,
  async (req, res, next) => {
    try {
      const update = { ...req.body, updatedAt: new Date() };
      delete update._id; delete update.userId;
      if (update.stage === 'Won' && !update.wonDate) update.wonDate = new Date();
      const lead = await Lead.findOneAndUpdate(
        q(req.user.id, { _id: req.params.id }),
        { $set: update },
        { new: true }
      );
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      await audit({ userId: req.user.id, action: 'LEAD_UPDATED', resource: 'Lead', resourceId: lead._id, req });
      res.json({ lead });
    } catch (err) { next(err); }
  }
);

// DELETE soft delete
router.delete('/:id', async (req, res, next) => {
  try {
    const lead = await Lead.findOneAndUpdate(
      q(req.user.id, { _id: req.params.id }),
      { $set: { deletedAt: new Date() } },
      { new: true }
    );
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    await audit({ userId: req.user.id, action: 'LEAD_DELETED', resource: 'Lead', resourceId: req.params.id, req });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST bulk import leads (from localStorage migration or CSV)
router.post('/bulk', async (req, res, next) => {
  try {
    const { leads } = req.body;
    if (!Array.isArray(leads)) return res.status(400).json({ error: 'leads array required' });
    const docs = leads.map(l => ({ ...l, userId: req.user.id, _id: undefined }));
    const inserted = await Lead.insertMany(docs, { ordered: false });
    res.json({ inserted: inserted.length });
  } catch (err) { next(err); }
});

module.exports = router;
