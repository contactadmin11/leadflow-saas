const express    = require('express');
const Template   = require('../models/Template');
const { protect }= require('../middleware/auth');
const router     = express.Router();
router.use(protect);
const q = (uid, ex = {}) => ({ userId: uid, deletedAt: null, ...ex });
router.get('/', async (req, res, next) => {
  try {
    const { type } = req.query;
    const filter = q(req.user.id);
    if (type) filter.type = type;
    const templates = await Template.find(filter).sort('-createdAt').lean();
    res.json({ templates });
  } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try { const t = await Template.create({ ...req.body, userId: req.user.id }); res.status(201).json({ template: t }); }
  catch (err) { next(err); }
});
router.put('/:id', async (req, res, next) => {
  try {
    const update = { ...req.body }; delete update._id; delete update.userId;
    const t = await Template.findOneAndUpdate(q(req.user.id, { _id: req.params.id }), { $set: update }, { new: true });
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json({ template: t });
  } catch (err) { next(err); }
});
router.delete('/:id', async (req, res, next) => {
  try { await Template.findOneAndUpdate(q(req.user.id, { _id: req.params.id }), { $set: { deletedAt: new Date() } }); res.json({ success: true }); }
  catch (err) { next(err); }
});
module.exports = router;
