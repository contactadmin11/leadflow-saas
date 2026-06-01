/**
 * Admin Panel Routes — License key management.
 * Protected by a SEPARATE admin JWT (not the regular user JWT).
 */
const express    = require('express');
const jwt        = require('jsonwebtoken');
const rateLimit  = require('express-rate-limit');
const License    = require('../models/License');
const User       = require('../models/User');
const AuditLog   = require('../models/AuditLog');
const { adminProtect } = require('../middleware/auth');
const { audit }  = require('../services/audit.service');
const { v4: uuidv4 } = require('uuid');
const router     = express.Router();

const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

// ── Admin Login ──────────────────────────────────────────────────────────
router.post('/login', adminLimiter, async (req, res) => {
  const { password } = req.body;
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    await audit({ action: 'ADMIN_LOGIN_FAILED', resource: 'Admin', req, success: false });
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  const token = jwt.sign(
    { role: 'super_admin', ts: Date.now() },
    process.env.ADMIN_JWT_SECRET,
    { expiresIn: '8h' }
  );
  await audit({ action: 'ADMIN_LOGIN', resource: 'Admin', req });
  res.json({ token });
});

// ── All routes below require admin JWT ───────────────────────────────────
router.use(adminProtect);

// ── Licenses ─────────────────────────────────────────────────────────────
router.get('/licenses', async (req, res, next) => {
  try {
    const licenses = await License.find().sort('-createdAt').lean();
    res.json({ licenses });
  } catch (err) { next(err); }
});

router.post('/licenses', async (req, res, next) => {
  try {
    const { clientName, clientEmail, clientMobile, plan, maxUsers, price, notes } = req.body;
    if (!clientName || !plan) return res.status(400).json({ error: 'clientName and plan required' });

    const PLAN_DAYS = { trial: 14, '1month': 30, '3months': 90, '6months': 180, '1year': 365, custom: parseInt(req.body.customDays) || 30 };
    const days    = PLAN_DAYS[plan] || 30;
    const expires = new Date();
    expires.setDate(expires.getDate() + days);

    // Generate unique key: LF-XXXX-XXXX-XXXX
    const key = 'LF-' + uuidv4().toUpperCase().replace(/-/g,'').slice(0,4) + '-' +
                uuidv4().toUpperCase().replace(/-/g,'').slice(0,4) + '-' +
                uuidv4().toUpperCase().replace(/-/g,'').slice(0,4);

    const license = await License.create({ key, clientName, clientEmail, clientMobile, plan, maxUsers: maxUsers || 1, expiresAt: expires, price: price || 0, notes });
    res.status(201).json({ license });
  } catch (err) { next(err); }
});

router.put('/licenses/:id/revoke', async (req, res, next) => {
  try {
    const license = await License.findByIdAndUpdate(req.params.id, { $set: { status: 'revoked' } }, { new: true });
    if (!license) return res.status(404).json({ error: 'License not found' });
    res.json({ license });
  } catch (err) { next(err); }
});

router.put('/licenses/:id/extend', async (req, res, next) => {
  try {
    const { days } = req.body;
    const license = await License.findById(req.params.id);
    if (!license) return res.status(404).json({ error: 'License not found' });
    const base = license.expiresAt > new Date() ? license.expiresAt : new Date();
    base.setDate(base.getDate() + (parseInt(days) || 30));
    license.expiresAt = base;
    await license.save();
    res.json({ license });
  } catch (err) { next(err); }
});

// ── License Verification (public, called from frontend) ──────────────────
router.post('/licenses/verify', async (req, res, next) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Key required' });
    const license = await License.findOne({ key: key.toUpperCase() });
    if (!license) return res.status(404).json({ valid: false, error: 'Invalid license key' });
    if (license.status === 'revoked') return res.json({ valid: false, error: 'License revoked' });
    if (license.status === 'expired') return res.json({ valid: false, error: 'License expired', daysRemaining: 0 });
    license.lastVerifiedAt = new Date();
    await license.save();
    res.json({
      valid: true,
      plan: license.plan,
      clientName: license.clientName,
      daysRemaining: license.daysRemaining,
      status: license.status,
      expiresAt: license.expiresAt
    });
  } catch (err) { next(err); }
});

// ── Users ─────────────────────────────────────────────────────────────────
router.get('/users', async (req, res, next) => {
  try {
    const users = await User.find({ deletedAt: null }).sort('-createdAt').lean();
    res.json({ users });
  } catch (err) { next(err); }
});

router.put('/users/:id/deactivate', async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { $set: { isActive: false } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Audit Logs ────────────────────────────────────────────────────────────
router.get('/audit-logs', async (req, res, next) => {
  try {
    const logs = await AuditLog.find().sort('-createdAt').limit(200).lean();
    res.json({ logs });
  } catch (err) { next(err); }
});

// ── Dashboard stats ───────────────────────────────────────────────────────
router.get('/dashboard', async (req, res, next) => {
  try {
    const [totalUsers, activeLicenses, expiringLicenses, recentLogs] = await Promise.all([
      User.countDocuments({ deletedAt: null }),
      License.countDocuments({ status: 'active' }),
      License.countDocuments({ status: 'expiring' }),
      AuditLog.find().sort('-createdAt').limit(10).lean()
    ]);
    res.json({ totalUsers, activeLicenses, expiringLicenses, recentLogs });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════
// ── DEVICE MANAGEMENT (Admin) ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
const Session      = require('../models/Session');
const Subscription = require('../models/Subscription');

// ── GET all active devices for a user ────────────────────────────────────
router.get('/users/:id/devices', async (req, res, next) => {
  try {
    const sessions = await Session.find({
      userId:    req.params.id,
      revokedAt: null,
      expiresAt: { $gt: new Date() }
    }).select('deviceName deviceFingerprint deviceInfo ip lastSeen createdAt').lean();

    const sub = await Subscription.findOne({ userId: req.params.id })
      .select('maxDevices plan status').lean();

    res.json({
      devices:    sessions,
      count:      sessions.length,
      maxDevices: sub?.maxDevices ?? 1,
      plan:       sub?.plan,
      status:     sub?.status
    });
  } catch (err) { next(err); }
});

// ── DELETE revoke a specific device session ───────────────────────────────
router.delete('/users/:id/devices/:sessionId', async (req, res, next) => {
  try {
    const session = await Session.findOne({
      _id:    req.params.sessionId,
      userId: req.params.id
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    session.revokedAt = new Date();
    await session.save();

    await audit({
      action: 'ADMIN_DEVICE_REVOKED',
      resource: 'Session',
      details: { userId: req.params.id, sessionId: req.params.sessionId, deviceName: session.deviceName },
      req
    });
    res.json({ success: true, message: `Device "${session.deviceName}" has been logged out` });
  } catch (err) { next(err); }
});

// ── DELETE revoke ALL devices for a user (reset all logins) ──────────────
router.delete('/users/:id/devices', async (req, res, next) => {
  try {
    const result = await Session.updateMany(
      { userId: req.params.id, revokedAt: null },
      { revokedAt: new Date() }
    );

    await audit({
      action: 'ADMIN_ALL_DEVICES_RESET',
      resource: 'Session',
      details: { userId: req.params.id, devicesRevoked: result.modifiedCount },
      req
    });
    res.json({
      success: true,
      message: `All ${result.modifiedCount} device(s) logged out. User must sign in again.`,
      devicesRevoked: result.modifiedCount
    });
  } catch (err) { next(err); }
});

// ── PUT set max devices for a user ────────────────────────────────────────
// maxDevices: 1 = single device, 2 = two devices, 0 = unlimited
router.put('/users/:id/max-devices', async (req, res, next) => {
  try {
    const { maxDevices } = req.body;
    if (maxDevices === undefined || maxDevices === null) {
      return res.status(400).json({ error: 'maxDevices required (0 = unlimited, 1+ = locked)' });
    }

    const sub = await Subscription.findOneAndUpdate(
      { userId: req.params.id },
      { $set: { maxDevices: parseInt(maxDevices) } },
      { new: true, upsert: true }
    );

    await audit({
      action: 'ADMIN_MAX_DEVICES_SET',
      resource: 'Subscription',
      details: { userId: req.params.id, maxDevices, plan: sub.plan },
      req
    });
    res.json({
      success: true,
      maxDevices: sub.maxDevices,
      message: maxDevices === 0
        ? 'Unlimited devices allowed for this user'
        : `User can now log in on ${maxDevices} device(s)`
    });
  } catch (err) { next(err); }
});

// ── GET all users with their device counts ────────────────────────────────
router.get('/users-devices', async (req, res, next) => {
  try {
    const users = await User.find({ deletedAt: null })
      .select('name email lastLoginAt isActive createdAt').lean();

    const userIds = users.map(u => u._id);
    const [sessions, subs] = await Promise.all([
      Session.find({ userId: { $in: userIds }, revokedAt: null, expiresAt: { $gt: new Date() } })
        .select('userId deviceName lastSeen ip').lean(),
      Subscription.find({ userId: { $in: userIds } })
        .select('userId plan status maxDevices currentPeriodEnd trialEndsAt').lean()
    ]);

    // Group by userId
    const sessionMap = {};
    sessions.forEach(s => {
      const uid = s.userId.toString();
      if (!sessionMap[uid]) sessionMap[uid] = [];
      sessionMap[uid].push(s);
    });

    const subMap = {};
    subs.forEach(s => { subMap[s.userId.toString()] = s; });

    const result = users.map(u => {
      const uid     = u._id.toString();
      const userSub = subMap[uid];
      return {
        ...u,
        subscription: userSub ? {
          plan:       userSub.plan,
          status:     userSub.status,
          maxDevices: userSub.maxDevices ?? 1,
          validUntil: userSub.currentPeriodEnd || userSub.trialEndsAt
        } : null,
        activeDevices: sessionMap[uid] || [],
        deviceCount:   (sessionMap[uid] || []).length
      };
    });

    res.json({ users: result });
  } catch (err) { next(err); }
});

module.exports = router;

