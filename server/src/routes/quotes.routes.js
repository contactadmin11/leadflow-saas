const express    = require('express');
const mongoose   = require('mongoose');
const Quote      = require('../models/Quote');
const Settings   = require('../models/Settings');
const { protect }= require('../middleware/auth');
const { calculateTotals } = require('../services/gst.service');
const { audit }  = require('../services/audit.service');
const { generateQuotePDF } = require('../services/pdf.service');
const router     = express.Router();

router.use(protect);
const q = (userId, extra = {}) => ({ userId, deletedAt: null, ...extra });

const nextQuoteNo = async (userId) => {
  const s = await Settings.findOneAndUpdate({ userId }, { $inc: { quoteCounter: 1 } }, { new: true, upsert: true });
  const prefix = s.quotePrefix || 'QT';
  const year   = new Date().getFullYear();
  const num    = String(s.quoteCounter).padStart(3, '0');
  return `${prefix}-${year}-${num}`;
};

router.get('/', async (req, res, next) => {
  try {
    const quotes = await Quote.find(q(req.user.id)).sort('-createdAt').lean();
    res.json({ quotes });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const quote = await Quote.findOne(q(req.user.id, { _id: req.params.id })).lean();
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json({ quote });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const settings = await Settings.findOne({ userId: req.user.id });
    const { items = [], buyerState, ...rest } = req.body;
    const totals  = calculateTotals(items, settings?.state, buyerState, settings?.gstEnabled !== false);
    const quoteNo = await nextQuoteNo(req.user.id);
    const quote   = await Quote.create({ ...rest, userId: req.user.id, quoteNo, items: totals.items, subtotal: totals.subtotal, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, total: totals.total, buyerState });
    res.status(201).json({ quote });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const settings = await Settings.findOne({ userId: req.user.id });
    const { items = [], buyerState, ...rest } = req.body;
    const totals = calculateTotals(items, settings?.state, buyerState, settings?.gstEnabled !== false);
    const update = { ...rest, items: totals.items, subtotal: totals.subtotal, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, total: totals.total, buyerState };
    delete update._id; delete update.userId; delete update.quoteNo;
    const quote = await Quote.findOneAndUpdate(q(req.user.id, { _id: req.params.id }), { $set: update }, { new: true });
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json({ quote });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await Quote.findOneAndUpdate(q(req.user.id, { _id: req.params.id }), { $set: { deletedAt: new Date() } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET quote PDF
router.get('/:id/pdf', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ 
        error: 'Invalid ID format',
        received: req.params.id
      });
    }
    const quote    = await Quote.findOne(q(req.user.id, { _id: req.params.id })).lean();
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    const settings = await Settings.findOne({ userId: req.user.id }).lean();
    const pdfBuf   = await generateQuotePDF(quote, settings || {});
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${quote.quoteNo}.pdf"` });
    res.send(pdfBuf);
  } catch (err) { next(err); }
});

module.exports = router;
