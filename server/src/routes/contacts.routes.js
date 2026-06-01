const express    = require('express');
const Contact    = require('../models/Contact');
const { protect }= require('../middleware/auth');
const router     = express.Router();
router.use(protect);
const q = (uid, ex = {}) => ({ userId: uid, deletedAt: null, ...ex });
router.get('/', async (req, res, next) => {
  try {
    const { search } = req.query;
    const filter = q(req.user.id);
    if (search) { const rx = new RegExp(search, 'i'); filter.$or = [{ name: rx }, { company: rx }, { email: rx }, { phone: rx }]; }
    const contacts = await Contact.find(filter).sort('-createdAt').lean();
    res.json({ contacts });
  } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try {
    const data = { ...req.body, userId: req.user.id }; delete data._id;
    const contact = await Contact.create(data);
    res.status(201).json({ contact });
  } catch (err) { next(err); }
});
router.put('/:id', async (req, res, next) => {
  try {
    const update = { ...req.body }; delete update._id; delete update.userId;
    const contact = await Contact.findOneAndUpdate(q(req.user.id, { _id: req.params.id }), { $set: update }, { new: true });
    if (!contact) return res.status(404).json({ error: 'Not found' });
    res.json({ contact });
  } catch (err) { next(err); }
});
router.delete('/:id', async (req, res, next) => {
  try { await Contact.findOneAndUpdate(q(req.user.id, { _id: req.params.id }), { $set: { deletedAt: new Date() } }); res.json({ success: true }); }
  catch (err) { next(err); }
});
module.exports = router;
