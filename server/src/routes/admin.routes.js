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
const Subscription = require('../models/Subscription');
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

    const PLAN_DAYS = { trial: 7, '1month': 30, '3months': 90, '6months': 180, '1year': 365, custom: parseInt(req.body.customDays) || 30 };
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

router.post('/licenses/:id/revoke', async (req, res, next) => {
  try {
    const license = await License.findByIdAndUpdate(req.params.id, { $set: { status: 'revoked' } }, { new: true });
    if (!license) return res.status(404).json({ error: 'License not found' });
    res.json({ license });
  } catch (err) { next(err); }
});

router.post('/licenses/:id/extend', async (req, res, next) => {
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

router.post('/licenses/:id/reactivate', async (req, res, next) => {
  try {
    const license = await License.findByIdAndUpdate(req.params.id, { $set: { status: 'active' } }, { new: true });
    res.json({ license });
  } catch (err) { next(err); }
});

router.post('/licenses/:id/delete', async (req, res, next) => {
  try {
    await License.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/licenses/:id/reset-devices', async (req, res, next) => {
  try {
    const license = await License.findById(req.params.id);
    if (!license || !license.userId) return res.json({ success: true });
    // Revoke all sessions for this user
    const Session = require('../models/Session');
    await Session.updateMany({ userId: license.userId }, { $set: { revokedAt: new Date() } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/licenses/:id/max-users', async (req, res, next) => {
  try {
    const { maxUsers } = req.body;
    const license = await License.findByIdAndUpdate(req.params.id, { $set: { maxUsers: parseInt(maxUsers) || 1 } }, { new: true });
    if (license && license.userId) {
      const Subscription = require('../models/Subscription');
      await Subscription.updateOne({ userId: license.userId }, { $set: { maxDevices: license.maxUsers } });
    }
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
    const Session = require('../models/Session');
    await Session.updateMany({ userId: req.params.id }, { $set: { revokedAt: new Date() } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.put('/users/:id/activate', async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { $set: { isActive: true } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete('/users/:id', async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { $set: { deletedAt: new Date(), isActive: false } });
    const Session = require('../models/Session');
    await Session.updateMany({ userId: req.params.id }, { $set: { revokedAt: new Date() } });
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
      .select('name email mobile lastLoginAt isActive createdAt').lean();

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


// ── Subscription Management (Admin) ─────────────────────────────────────────

// GET all subscriptions with user info
router.get('/subscriptions', async (req, res, next) => {
  try {
    const subs = await Subscription.find().sort('-createdAt').lean();
    const users = await User.find({ _id: { $in: subs.map(s => s.userId) } }, 'email name mobile').lean();
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });
    const result = subs.map(s => ({
      ...s,
      user: userMap[s.userId?.toString()] || null,
      daysLeft: s.plan === 'trial'
        ? Math.max(0, Math.ceil((new Date(s.trialEndsAt) - new Date()) / 86400000))
        : Math.max(0, Math.ceil((new Date(s.currentPeriodEnd) - new Date()) / 86400000))
    }));
    res.json({ subscriptions: result });
  } catch (err) { next(err); }
});

// POST extend trial by N days for a user
router.post('/subscriptions/:userId/extend-trial', async (req, res, next) => {
  try {
    const { days = 7 } = req.body;
    const sub = await Subscription.findOne({ userId: req.params.userId });
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    if (sub.plan !== 'trial') return res.status(400).json({ error: 'User is not on trial plan' });
    const currentEnd = new Date(sub.trialEndsAt) > new Date() ? new Date(sub.trialEndsAt) : new Date();
    currentEnd.setDate(currentEnd.getDate() + parseInt(days));
    sub.trialEndsAt = currentEnd;
    sub.status = 'active';
    await sub.save();
    await audit({ action: 'ADMIN_TRIAL_EXTENDED', resource: 'Subscription', resourceId: sub._id, details: { userId: req.params.userId, days }, req });
    res.json({ success: true, newTrialEnd: sub.trialEndsAt });
  } catch (err) { next(err); }
});

// POST force-expire trial for a user
router.post('/subscriptions/:userId/force-expire', async (req, res, next) => {
  try {
    const sub = await Subscription.findOneAndUpdate(
      { userId: req.params.userId },
      { $set: { status: 'expired', trialEndsAt: new Date() } },
      { new: true }
    );
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    await audit({ action: 'ADMIN_TRIAL_FORCE_EXPIRED', resource: 'Subscription', resourceId: sub._id, details: { userId: req.params.userId }, req });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST grant lifetime subscription to a user
router.post('/subscriptions/:userId/grant-lifetime', async (req, res, next) => {
  try {
    const sub = await Subscription.findOneAndUpdate(
      { userId: req.params.userId },
      { $set: { plan: 'lifetime', status: 'active', notes: 'Admin granted lifetime' } },
      { new: true, upsert: true }
    );
    await audit({ action: 'ADMIN_LIFETIME_GRANTED', resource: 'Subscription', resourceId: sub._id, details: { userId: req.params.userId }, req });
    res.json({ success: true, subscription: sub });
  } catch (err) { next(err); }
});

// ── License device-fingerprint management ────────────────────────────────

// GET bound devices for a license
router.get('/licenses/:id/devices', async (req, res, next) => {
  try {
    const license = await License.findById(req.params.id).select('key clientName boundDevices maxDevices activeDevices');
    if (!license) return res.status(404).json({ error: 'License not found' });
    res.json({ boundDevices: license.boundDevices || [], maxDevices: license.maxDevices });
  } catch (err) { next(err); }
});

// POST reset (clear) all bound devices for a license
router.post('/licenses/:id/reset-bound-devices', async (req, res, next) => {
  try {
    const license = await License.findByIdAndUpdate(
      req.params.id,
      { $set: { boundDevices: [], activeDevices: 0 } },
      { new: true }
    );
    if (!license) return res.status(404).json({ error: 'License not found' });
    await audit({ action: 'ADMIN_LICENSE_DEVICES_RESET', resource: 'License', resourceId: license._id, req });
    res.json({ success: true, license });
  } catch (err) { next(err); }
});

// DELETE remove a specific bound device fingerprint
router.delete('/licenses/:id/devices/:fingerprint', async (req, res, next) => {
  try {
    const license = await License.findByIdAndUpdate(
      req.params.id,
      { $pull: { boundDevices: req.params.fingerprint }, $inc: { activeDevices: -1 } },
      { new: true }
    );
    if (!license) return res.status(404).json({ error: 'License not found' });
    await audit({ action: 'ADMIN_LICENSE_DEVICE_REMOVED', resource: 'License', resourceId: license._id, details: { fingerprint: req.params.fingerprint }, req });
    res.json({ success: true, license });
  } catch (err) { next(err); }
});

// PUT update max devices for a license
router.put('/licenses/:id/max-devices', async (req, res, next) => {
  try {
    const { maxDevices } = req.body;
    if (maxDevices === undefined || maxDevices === null) return res.status(400).json({ error: 'maxDevices required' });
    const license = await License.findByIdAndUpdate(
      req.params.id,
      { $set: { maxDevices: parseInt(maxDevices) || 1 } },
      { new: true }
    );
    if (!license) return res.status(404).json({ error: 'License not found' });
    res.json({ license });
  } catch (err) { next(err); }
});

module.exports = router;



