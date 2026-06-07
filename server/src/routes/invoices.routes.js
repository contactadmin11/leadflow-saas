const express    = require('express');
const Invoice    = require('../models/Invoice');
const Settings   = require('../models/Settings');
const Product    = require('../models/Product');
const { protect }= require('../middleware/auth');
const { calculateTotals } = require('../services/gst.service');
const { generateInvoicePDF } = require('../services/pdf.service');
const { audit }  = require('../services/audit.service');
const router     = express.Router();

router.use(protect);
const q = (uid, extra = {}) => ({ userId: uid, deletedAt: null, ...extra });

/**
 * Validate that all items in the invoice exist in the user's product catalogue.
 * Skips items that have a productId (properly linked).
 * If catalogue enforcement is not strict, this just logs a warning.
 */
const validateItems = async (userId, items = []) => {
  if (!items.length) return; // nothing to validate
  const names = items.map(i => (i.name || '').trim()).filter(Boolean);
  if (!names.length) return;
  // Find matching products for this user
  const products = await Product.find({ userId, deletedAt: null, name: { $in: names } }).lean();
  const productNames = new Set(products.map(p => p.name.trim()));
  const invalid = names.filter(n => !productNames.has(n));
  if (invalid.length) {
    throw Object.assign(
      new Error(`The following items are not in your product catalogue: ${invalid.join(', ')}. Please add them in Products before invoicing.`),
      { statusCode: 422 }
    );
  }
};

const nextInvNo = async (userId) => {
  const s = await Settings.findOneAndUpdate({ userId }, { $inc: { invCounter: 1 } }, { new: true, upsert: true });
  const prefix = s.invPrefix || 'INV';
  const year   = new Date().getFullYear();
  const num    = String(s.invCounter).padStart(3, '0');
  return `${prefix}-${year}-${num}`;
};

router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    const filter = q(req.user.id);
    if (status) filter.status = status;
    // Auto-update overdue invoices
    const now = new Date();
    await Invoice.updateMany({ userId: req.user.id, deletedAt: null, status: 'Sent', dueDate: { $lt: now } }, { $set: { status: 'Overdue' } });
    const invoices = await Invoice.find(filter).sort('-createdAt').lean();
    res.json({ invoices });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const inv = await Invoice.findOne(q(req.user.id, { _id: req.params.id })).lean();
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ invoice: inv });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const settings  = await Settings.findOne({ userId: req.user.id });
    const { items = [], buyerState, ...rest } = req.body;
    // Enforce catalogue-only items
    await validateItems(req.user.id, items);
    const totals    = calculateTotals(items, settings?.state, buyerState, settings?.gstEnabled !== false);
    const invoiceNo = await nextInvNo(req.user.id);
    const dueDate   = rest.dueDate || (() => { const d = new Date(); d.setDate(d.getDate() + (settings?.payTerms || 30)); return d; })();
    const invoice   = await Invoice.create({ ...rest, userId: req.user.id, invoiceNo, items: totals.items, subtotal: totals.subtotal, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, total: totals.total, buyerState, dueDate });
    await audit({ userId: req.user.id, action: 'INVOICE_CREATED', resource: 'Invoice', resourceId: invoice._id, req });
    res.status(201).json({ invoice });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const settings = await Settings.findOne({ userId: req.user.id });
    const { items = [], buyerState, ...rest } = req.body;
    // Enforce catalogue-only items on update too
    await validateItems(req.user.id, items);
    const totals = calculateTotals(items, settings?.state, buyerState, settings?.gstEnabled !== false);
    const update = { ...rest, items: totals.items, subtotal: totals.subtotal, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, total: totals.total, buyerState };
    delete update._id; delete update.userId; delete update.invoiceNo;
    const invoice = await Invoice.findOneAndUpdate(q(req.user.id, { _id: req.params.id }), { $set: update }, { new: true });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ invoice });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await Invoice.findOneAndUpdate(q(req.user.id, { _id: req.params.id }), { $set: { deletedAt: new Date() } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET invoice PDF
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const invoice  = await Invoice.findOne(q(req.user.id, { _id: req.params.id })).lean();
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const settings = await Settings.findOne({ userId: req.user.id }).lean();
    const pdfBuf   = await generateInvoicePDF(invoice, settings || {});
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${invoice.invoiceNo}.pdf"` });
    res.send(pdfBuf);
  } catch (err) { next(err); }
});

// POST generate PDF as base64 (for messenger)
router.post('/:id/pdf-base64', async (req, res, next) => {
  try {
    const invoice  = await Invoice.findOne(q(req.user.id, { _id: req.params.id })).lean();
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const settings = await Settings.findOne({ userId: req.user.id }).lean();
    const pdfBuf   = await generateInvoicePDF(invoice, settings || {});
    res.json({ pdfBase64: pdfBuf.toString('base64'), filename: `${invoice.invoiceNo}.pdf` });
  } catch (err) { next(err); }
});

module.exports = router;
