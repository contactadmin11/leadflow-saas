const Invoice = require('../models/Invoice');
const Quote   = require('../models/Quote');
const Settings = require('../models/Settings');
const { generateInvoicePDF, generateQuotePDF } = require('./pdf.service');

/**
 * Create a PDF buffer for a given document type.
 * @param {string} docType - 'invoice' | 'quote'
 * @param {string} docId - MongoDB document ID
 * @param {string} userId - Owner user ID
 * @returns {{ buffer: Buffer, filename: string }}
 */
const createPDFBuffer = async (docType, docId, userId) => {
  const settings = await Settings.findOne({ userId }).lean();
  if (!settings) throw new Error('User settings not found');

  if (docType === 'invoice') {
    const invoice = await Invoice.findOne({ _id: docId, userId, deletedAt: null }).lean();
    if (!invoice) throw new Error('Invoice not found');
    const buffer = await generateInvoicePDF(invoice, settings || {});
    const filename = `${invoice.invoiceNo}.pdf`;
    return { buffer, filename };
  }

  if (docType === 'quote') {
    const quote = await Quote.findOne({ _id: docId, userId, deletedAt: null }).lean();
    if (!quote) throw new Error('Quote not found');
    const buffer = await generateQuotePDF(quote, settings || {});
    const filename = `${quote.quoteNo}.pdf`;
    return { buffer, filename };
  }

  throw new Error('Invalid docType');
};

module.exports = { createPDFBuffer };
