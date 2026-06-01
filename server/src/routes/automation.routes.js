const express    = require('express');
const AutoRule   = require('../models/AutoRule');
const { protect }= require('../middleware/auth');
const router     = express.Router();
router.use(protect);
const q = (uid, ex = {}) => ({ userId: uid, ...ex });
router.get('/', async (req, res, next) => {
  try { const rules = await AutoRule.find(q(req.user.id)).lean(); res.json({ rules }); }
  catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try { const r = await AutoRule.create({ ...req.body, userId: req.user.id }); res.status(201).json({ rule: r }); }
  catch (err) { next(err); }
});
router.put('/:id', async (req, res, next) => {
  try {
    const update = { ...req.body }; delete update._id; delete update.userId;
    const r = await AutoRule.findOneAndUpdate(q(req.user.id, { _id: req.params.id }), { $set: update }, { new: true });
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json({ rule: r });
  } catch (err) { next(err); }
});
router.delete('/:id', async (req, res, next) => {
  try { await AutoRule.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { next(err); }
});
module.exports = router;
