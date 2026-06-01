/**
 * Onboarding routes — client onboarding checklists
 */
const express      = require('express');
const Onboarding   = require('../models/Onboarding');
const { protect }  = require('../middleware/auth');
const router       = express.Router();

router.use(protect);

router.get('/', async (req, res, next) => {
  try {
    const obs = await Onboarding.find({ userId: req.user.id })
      .populate('clientId', 'name company').lean();
    res.json({ onboardings: obs });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const ob = await Onboarding.findOne({ _id: req.params.id, userId: req.user.id })
      .populate('clientId', 'name company').lean();
    if (!ob) return res.status(404).json({ error: 'Not found' });
    res.json({ onboarding: ob });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { checklist, notes, owner } = req.body;
    let progress = 0;
    if (checklist && checklist.length) {
      progress = Math.round(checklist.filter(c => c.done).length / checklist.length * 100);
    }
    const ob = await Onboarding.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: { checklist, notes, owner, progress } },
      { new: true }
    );
    if (!ob) return res.status(404).json({ error: 'Not found' });
    res.json({ onboarding: ob });
  } catch (err) { next(err); }
});

module.exports = router;
