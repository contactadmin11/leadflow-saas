const express    = require('express');
const Product    = require('../models/Product');
const { protect }= require('../middleware/auth');
const router     = express.Router();
router.use(protect);
const q = (uid, ex = {}) => ({ userId: uid, deletedAt: null, ...ex });
router.get('/', async (req, res, next) => {
  try { const products = await Product.find(q(req.user.id)).sort('-createdAt').lean(); res.json({ products }); }
  catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try { const p = await Product.create({ ...req.body, userId: req.user.id }); res.status(201).json({ product: p }); }
  catch (err) { next(err); }
});
router.put('/:id', async (req, res, next) => {
  try {
    const update = { ...req.body }; delete update._id; delete update.userId;
    const p = await Product.findOneAndUpdate(q(req.user.id, { _id: req.params.id }), { $set: update }, { new: true });
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({ product: p });
  } catch (err) { next(err); }
});
router.delete('/:id', async (req, res, next) => {
  try { await Product.findOneAndUpdate(q(req.user.id, { _id: req.params.id }), { $set: { deletedAt: new Date() } }); res.json({ success: true }); }
  catch (err) { next(err); }
});
module.exports = router;
