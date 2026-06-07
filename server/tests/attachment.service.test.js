/**
 * Unit tests for attachment.service.js
 * Tests PDF buffer creation for both invoice and quote docTypes.
 * Uses Jest mocks so no real DB or PDF library is needed.
 */

jest.mock('../src/models/Invoice');
jest.mock('../src/models/Quote');
jest.mock('../src/models/Settings');
jest.mock('../src/services/pdf.service');

const Invoice  = require('../src/models/Invoice');
const Quote    = require('../src/models/Quote');
const Settings = require('../src/models/Settings');
const { generateInvoicePDF, generateQuotePDF } = require('../src/services/pdf.service');
const { createPDFBuffer } = require('../src/services/attachment.service');

const FAKE_SETTINGS = { bizName: 'TestCo', currency: '₹', gstEnabled: true };
const FAKE_INVOICE  = {
  _id: 'inv1', invoiceNo: 'INV-2024-001', userId: 'u1',
  clientName: 'Client A', items: [{ name: 'Widget', qty: 1, rate: 100, gstRate: 18, gstAmt: 18, total: 118 }],
  subtotal: 100, cgst: 9, sgst: 9, igst: 0, total: 118
};
const FAKE_QUOTE = {
  _id: 'qt1', quoteNo: 'QT-2024-001', userId: 'u1',
  clientName: 'Client B', items: [{ name: 'Service', qty: 2, rate: 200, gstRate: 18, total: 472 }],
  subtotal: 400, cgst: 36, sgst: 36, igst: 0, total: 472
};
const FAKE_BUFFER = Buffer.from('fake-pdf-bytes');

describe('attachment.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Settings.findOne.mockReturnValue({ lean: () => Promise.resolve(FAKE_SETTINGS) });
    generateInvoicePDF.mockResolvedValue(FAKE_BUFFER);
    generateQuotePDF.mockResolvedValue(FAKE_BUFFER);
  });

  test('creates PDF buffer for invoice docType', async () => {
    Invoice.findOne.mockReturnValue({ lean: () => Promise.resolve(FAKE_INVOICE) });

    const result = await createPDFBuffer('invoice', 'inv1', 'u1');

    expect(result.buffer).toBe(FAKE_BUFFER);
    expect(result.filename).toBe('INV-2024-001.pdf');
    expect(generateInvoicePDF).toHaveBeenCalledWith(FAKE_INVOICE, FAKE_SETTINGS);
    expect(generateQuotePDF).not.toHaveBeenCalled();
  });

  test('creates PDF buffer for quote docType', async () => {
    Quote.findOne.mockReturnValue({ lean: () => Promise.resolve(FAKE_QUOTE) });

    const result = await createPDFBuffer('quote', 'qt1', 'u1');

    expect(result.buffer).toBe(FAKE_BUFFER);
    expect(result.filename).toBe('QT-2024-001.pdf');
    expect(generateQuotePDF).toHaveBeenCalledWith(FAKE_QUOTE, FAKE_SETTINGS);
    expect(generateInvoicePDF).not.toHaveBeenCalled();
  });

  test('throws when invoice not found', async () => {
    Invoice.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });

    await expect(createPDFBuffer('invoice', 'bad-id', 'u1'))
      .rejects.toThrow('Invoice not found');
  });

  test('throws when quote not found', async () => {
    Quote.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });

    await expect(createPDFBuffer('quote', 'bad-id', 'u1'))
      .rejects.toThrow('Quote not found');
  });

  test('throws when settings not found', async () => {
    Settings.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });

    await expect(createPDFBuffer('invoice', 'inv1', 'u1'))
      .rejects.toThrow('User settings not found');
  });

  test('throws for invalid docType', async () => {
    await expect(createPDFBuffer('payment', 'inv1', 'u1'))
      .rejects.toThrow('Invalid docType');
  });

  test('handles gstAmt field (legacy data) in invoice items', async () => {
    const legacyInvoice = { ...FAKE_INVOICE, items: [{ name: 'Widget', gstAmt: 18, gstAmount: undefined }] };
    Invoice.findOne.mockReturnValue({ lean: () => Promise.resolve(legacyInvoice) });

    const result = await createPDFBuffer('invoice', 'inv1', 'u1');
    expect(result.buffer).toBeDefined();
    expect(generateInvoicePDF).toHaveBeenCalledWith(legacyInvoice, FAKE_SETTINGS);
  });
});
