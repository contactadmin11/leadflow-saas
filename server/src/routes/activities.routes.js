const express    = require('express');
const Activity   = require('../models/Activity');
const Lead       = require('../models/Lead');
const { protect }= require('../middleware/auth');
const router     = express.Router();

router.use(protect);
const q = (uid, ex = {}) => ({ userId: uid, deletedAt: null, ...ex });

router.get('/', async (req, res, next) => {
  try {
    const { leadId, type } = req.query;
    const filter = q(req.user.id);
    if (leadId) filter.leadId = leadId;
    if (type)   filter.type   = type;
    const activities = await Activity.find(filter).sort('-date').lean();
    res.json({ activities });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { leadId, type, notes, date, outcome, nextFollowup } = req.body;
    if (!leadId || !type || !notes) return res.status(400).json({ error: 'leadId, type, notes required' });
    const activity = await Activity.create({ userId: req.user.id, leadId, type, notes, date, outcome, nextFollowup });
    // Auto-advance lead stage: New -> Contacted on first call/email/meeting
    const lead = await Lead.findOne(q(req.user.id, { _id: leadId }));
    if (lead) {
      let changed = false;
      if (lead.stage === 'New' && ['call','email','meeting'].includes(type)) {
        lead.stage = 'Contacted';
        changed = true;
      }
      if (outcome === 'Not Interested') { lead.stage = 'Lost'; changed = true; }
      if (nextFollowup) { lead.nextFollowUp = nextFollowup; changed = true; }
      if (changed) { lead.updatedAt = new Date(); await lead.save(); }
    }
    res.status(201).json({ activity });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await Activity.findOneAndUpdate(q(req.user.id, { _id: req.params.id }), { $set: { deletedAt: new Date() } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
