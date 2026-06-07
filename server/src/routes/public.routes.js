const express = require('express');
const Invoice = require('../models/Invoice');
const Quote = require('../models/Quote');
const Settings = require('../models/Settings');
const { generateInvoicePDF, generateQuotePDF } = require('../services/pdf.service');

const router = express.Router();

/**
 * GET /api/public/document/:type/:id
 * Publicly accessible route to download an invoice or quote PDF.
 * This is used for WhatsApp links where attachments are not possible.
 */
/**
 * GET /api/public/invoice/:id/pdf
 * Strictly requested URL format for WhatsApp linking
 */
router.get('/invoice/:id/pdf', async (req, res, next) => {
  try {
    const { id } = req.params;
    const invoice = await Invoice.findOne({ _id: id, deletedAt: null }).lean();
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    
    const settings = await Settings.findOne({ userId: invoice.userId }).lean();
    const pdfBuf = await generateInvoicePDF(invoice, settings || {});
    
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Invoice-${invoice.invoiceNo}.pdf"`
    });
    return res.send(pdfBuf);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/quote/:id/pdf
 */
router.get('/quote/:id/pdf', async (req, res, next) => {
  try {
    const { id } = req.params;
    const quote = await Quote.findOne({ _id: id, deletedAt: null }).lean();
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    
    const settings = await Settings.findOne({ userId: quote.userId }).lean();
    const pdfBuf = await generateQuotePDF(quote, settings || {});
    
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Quote-${quote.quoteNo}.pdf"`
    });
    return res.send(pdfBuf);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
