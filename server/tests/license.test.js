const express = require('express');
const request = require('supertest');
const adminRoutes = require('../src/routes/admin.routes');
const License = require('../src/models/License');
const Session = require('../src/models/Session');
const Subscription = require('../src/models/Subscription');

jest.mock('../src/models/License');
jest.mock('../src/models/Session');
jest.mock('../src/models/Subscription');
jest.mock('../src/models/User');
jest.mock('../src/models/AuditLog');
jest.mock('../src/services/audit.service', () => ({
  audit: jest.fn()
}));
jest.mock('../src/middleware/auth', () => ({
  adminProtect: (req, res, next) => {
    req.user = { role: 'super_admin' };
    next();
  }
}));

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);

describe('License and Device Binding System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('License Management', () => {
    test('POST /api/admin/licenses creates a new license', async () => {
      License.create.mockResolvedValue({ _id: 'lic1', key: 'LF-1234', clientName: 'Test Corp', maxUsers: 2 });
      
      const res = await request(app)
        .post('/api/admin/licenses')
        .send({ clientName: 'Test Corp', plan: '1month', maxUsers: 2 });

      expect(res.statusCode).toBe(201);
      expect(res.body.license).toHaveProperty('key');
      expect(res.body.license.clientName).toBe('Test Corp');
    });

    test('POST /api/admin/licenses/verify correctly verifies an active license', async () => {
      License.findOne.mockResolvedValue({ 
        key: 'LF-VALID', 
        status: 'active', 
        plan: '1month',
        clientName: 'Test',
        daysRemaining: 15,
        save: jest.fn()
      });

      const res = await request(app)
        .post('/api/admin/licenses/verify')
        .send({ key: 'LF-VALID' });

      expect(res.statusCode).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.plan).toBe('1month');
    });
  });

  describe('Device Binding Management', () => {
    test('DELETE /api/admin/users/:id/devices/:sessionId revokes a single device', async () => {
      const mockSave = jest.fn();
      Session.findOne.mockResolvedValue({ _id: 'sess1', userId: 'user1', deviceName: 'iPhone', save: mockSave });

      const res = await request(app)
        .delete('/api/admin/users/user1/devices/sess1');

      expect(res.statusCode).toBe(200);
      expect(mockSave).toHaveBeenCalled();
      expect(res.body.success).toBe(true);
    });

    test('DELETE /api/admin/users/:id/devices revokes all devices for user', async () => {
      Session.updateMany.mockResolvedValue({ modifiedCount: 3 });

      const res = await request(app)
        .delete('/api/admin/users/user1/devices');

      expect(res.statusCode).toBe(200);
      expect(res.body.devicesRevoked).toBe(3);
    });

    test('PUT /api/admin/users/:id/max-devices updates max devices in subscription', async () => {
      Subscription.findOneAndUpdate.mockResolvedValue({ userId: 'user1', maxDevices: 5, plan: 'monthly' });

      const res = await request(app)
        .put('/api/admin/users/user1/max-devices')
        .send({ maxDevices: 5 });

      expect(res.statusCode).toBe(200);
      expect(res.body.maxDevices).toBe(5);
    });
  });
});
