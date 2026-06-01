const express    = require('express');
const Payment    = require('../models/Payment');
const Invoice    = require('../models/Invoice');
const { protect }= require('../middleware/auth');
const { audit }  = require('../services/audit.service');
const router     = express.Router();

router.use(protect);
const q = (uid, ex = {}) => ({ userId: uid, deletedAt: null, ...ex });

router.get('/', async (req, res, next) => {
  try {
    const payments = await Payment.find(q(req.user.id)).sort('-date').lean();
    res.json({ payments });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { invoiceId, amount, date, mode, reference, tds } = req.body;
    if (!invoiceId || !amount) return res.status(400).json({ error: 'invoiceId and amount required' });
    const payment = await Payment.create({ userId: req.user.id, invoiceId, amount: Number(amount), date, mode, reference, tds: Number(tds) || 0 });
    // Update invoice paidAmount
    const invoice = await Invoice.findById(invoiceId);
    if (invoice) {
      invoice.paidAmount = (invoice.paidAmount || 0) + Number(amount);
      if (invoice.paidAmount >= invoice.total) invoice.status = 'Paid';
      else if (invoice.paidAmount > 0) invoice.status = 'Partial';
      await invoice.save();
    }
    await audit({ userId: req.user.id, action: 'PAYMENT_RECORDED', resource: 'Payment', resourceId: payment._id, details: { amount }, req });
    res.status(201).json({ payment });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const payment = await Payment.findOneAndUpdate(q(req.user.id, { _id: req.params.id }), { $set: { deletedAt: new Date() } }, { new: true });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    // Reverse invoice paidAmount
    const invoice = await Invoice.findById(payment.invoiceId);
    if (invoice) {
      invoice.paidAmount = Math.max(0, (invoice.paidAmount || 0) - payment.amount);
      if (invoice.paidAmount <= 0) invoice.status = invoice.dueDate < new Date() ? 'Overdue' : 'Sent';
      else invoice.status = 'Partial';
      await invoice.save();
    }
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
