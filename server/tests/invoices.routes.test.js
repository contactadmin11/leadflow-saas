/**
 * Unit tests for invoices.routes.js validation logic.
 * Tests that manual items not in the product catalogue are rejected.
 */

const express = require('express');
const request = require('supertest');
const invoicesRoutes = require('../src/routes/invoices.routes');
const Product = require('../src/models/Product');
const Settings = require('../src/models/Settings');
const Invoice = require('../src/models/Invoice');
const { protect } = require('../src/middleware/auth');

// Mock external dependencies
jest.mock('../src/models/Product');
jest.mock('../src/models/Settings');
jest.mock('../src/models/Invoice');
jest.mock('../src/middleware/auth', () => ({
  protect: (req, res, next) => {
    req.user = { id: 'user1' };
    next();
  }
}));
jest.mock('../src/services/gst.service', () => ({
  calculateTotals: () => ({ items: [], subtotal: 100, cgst: 0, sgst: 0, igst: 0, total: 100 })
}));
jest.mock('../src/services/audit.service', () => ({
  audit: jest.fn()
}));

const app = express();
app.use(express.json());
app.use('/api/invoices', invoicesRoutes);

describe('Invoice Routes - Manual Item Restriction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Settings.findOne.mockReturnValue({ lean: () => Promise.resolve({ state: 'Delhi', gstEnabled: true }), invCounter: 1 });
    Settings.findOneAndUpdate.mockResolvedValue({ invPrefix: 'INV', invCounter: 2 });
    Invoice.create.mockResolvedValue({ _id: 'inv1' });
    Invoice.findOneAndUpdate.mockResolvedValue({ _id: 'inv1' });
  });

  test('POST / creates invoice when all items exist in Product catalogue', async () => {
    const items = [{ name: 'Service A', qty: 1, rate: 100 }];
    // Mock Product.find to return 'Service A'
    Product.find.mockReturnValue({ lean: () => Promise.resolve([{ name: 'Service A' }]) });

    const res = await request(app)
      .post('/api/invoices')
      .send({ items, clientName: 'Test Client' });

    expect(res.statusCode).toBe(201);
    expect(Product.find).toHaveBeenCalledWith({ userId: 'user1', deletedAt: null, name: { $in: ['Service A'] } });
  });

  test('POST / rejects invoice when an item is missing from Product catalogue', async () => {
    const items = [
      { name: 'Service A', qty: 1, rate: 100 },
      { name: 'Manual Item', qty: 1, rate: 50 }
    ];
    // Mock Product.find to ONLY return 'Service A'
    Product.find.mockReturnValue({ lean: () => Promise.resolve([{ name: 'Service A' }]) });

    const res = await request(app)
      .post('/api/invoices')
      .send({ items, clientName: 'Test Client' });

    // Assuming the error handler catches the 422 thrown by validateItems
    // If there's no global error handler in the test, it might return 500. We check for the error string.
    expect(res.text).toContain('The following items are not in your product catalogue: Manual Item');
  });

  test('PUT /:id rejects update when an item is missing from Product catalogue', async () => {
    const items = [{ name: 'Manual Item', qty: 1, rate: 50 }];
    Product.find.mockReturnValue({ lean: () => Promise.resolve([]) });

    const res = await request(app)
      .put('/api/invoices/inv1')
      .send({ items });

    expect(res.text).toContain('The following items are not in your product catalogue: Manual Item');
  });
});
