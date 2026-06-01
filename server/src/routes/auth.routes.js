/**
 * Auth Routes with Device Locking
 * ═══════════════════════════════════════════════════════════════
 * Changes from basic auth:
 * 1. Login sets httpOnly cookie for refresh token (not returned in body)
 * 2. Login validates device fingerprint against active sessions
 * 3. Login checks maxDevices limit from Subscription
 * 4. Refresh uses cookie instead of body token
 * 5. Logout clears the cookie
 */
const express       = require('express');
const { body }      = require('express-validator');
const rateLimit     = require('express-rate-limit');
const jwt           = require('jsonwebtoken');
const User          = require('../models/User');
const Session       = require('../models/Session');
const Settings      = require('../models/Settings');
const Subscription  = require('../models/Subscription');
const { protect }   = require('../middleware/auth');
const { audit }     = require('../services/audit.service');
const { validate }  = require('../middleware/validate');
const { _createTrial } = require('./subscription.routes');
const router        = express.Router();

const REFRESH_COOKIE = 'lf_refresh';
const COOKIE_OPTS = {
  httpOnly:  true,    // JS cannot read this cookie
  secure:    process.env.NODE_ENV === 'production', // HTTPS only in production
  sameSite:  process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge:    30 * 24 * 60 * 60 * 1000,  // 30 days in ms
  path:      '/'
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' },
  standardHeaders: true, legacyHeaders: false
});

const signAccess  = (user) => jwt.sign(
  { id: user._id, email: user.email, role: user.role, name: user.name },
  process.env.JWT_ACCESS_SECRET,
  { expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m' }
);

const signRefresh = (user) => jwt.sign(
  { id: user._id },
  process.env.JWT_REFRESH_SECRET,
  { expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d' }
);

// ── Helper: count active devices for a user ─────────────────────────────────
async function countActiveDevices(userId) {
  return Session.countDocuments({
    userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() }
  });
}

// ── Helper: get device info from request headers ───────────────────────────
function getDeviceInfo(req, bodyInfo) {
  return {
    fingerprint: req.headers['x-device-id']   || null,
    name:        req.headers['x-device-name']  || bodyInfo?.name || 'Unknown Device',
    userAgent:   req.headers['user-agent']     || '',
    ip:          req.ip,
    ...(bodyInfo || {})
  };
}

// ── Register ──────────────────────────────────────────────────────────────────
router.post('/register',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('name').trim().notEmpty().withMessage('Name is required')
  ],
  validate,
  async (req, res, next) => {
    try {
      const { email, password, name, deviceInfo: bodyDeviceInfo } = req.body;
      const exists = await User.findOne({ email });
      if (exists) return res.status(409).json({ error: 'Email already registered' });

      const passwordHash = await User.hashPassword(password);
      const user         = await User.create({ email, passwordHash, name });

      // Create settings + 14-day trial
      await Settings.create({ userId: user._id, bizName: name, userName: name });
      await _createTrial(user._id);

      const deviceInfo = getDeviceInfo(req, bodyDeviceInfo);
      const accessToken  = signAccess(user);
      const refreshToken = signRefresh(user);
      const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await Session.create({
        userId:            user._id,
        refreshToken,
        deviceFingerprint: deviceInfo.fingerprint,
        deviceName:        deviceInfo.name,
        deviceInfo,
        ip:                req.ip,
        expiresAt:         exp
      });

      // Set httpOnly cookie for refresh token
      res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTS);

      await audit({ userId: user._id, action: 'REGISTER', resource: 'User', req });
      res.status(201).json({
        accessToken,  // Only access token in body
        user: { id: user._id, email: user.email, name: user.name, role: user.role },
        subscription: { plan: 'trial', daysRemaining: 14 }
      });
    } catch (err) { next(err); }
  }
);

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
  ],
  validate,
  async (req, res, next) => {
    try {
      const { email, password, deviceInfo: bodyDeviceInfo } = req.body;
      const user = await User.findOne({ email, deletedAt: null }).select('+passwordHash');

      if (!user || !(await user.checkPassword(password))) {
        await audit({ action: 'LOGIN_FAILED', resource: 'User', details: { email }, req, success: false });
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      if (!user.isActive) return res.status(403).json({ error: 'Account deactivated. Contact support.' });

      const deviceInfo = getDeviceInfo(req, bodyDeviceInfo);
      const fingerprint = deviceInfo.fingerprint;

      // ── Device Locking Check ───────────────────────────────────────────────
      const sub = await Subscription.findOne({ userId: user._id });
      const maxDevices = sub?.maxDevices ?? 1; // Default: 1 device

      if (maxDevices !== 0 && fingerprint) {
        // Get active sessions for this user
        const activeSessions = await Session.find({
          userId:    user._id,
          revokedAt: null,
          expiresAt: { $gt: new Date() }
        }).select('deviceFingerprint deviceName ip lastSeen');

        const uniqueFingerprints = [...new Set(activeSessions
          .filter(s => s.deviceFingerprint)
          .map(s => s.deviceFingerprint))];

        const isKnownDevice = uniqueFingerprints.includes(fingerprint);

        if (!isKnownDevice && uniqueFingerprints.length >= maxDevices) {
          // Device limit reached — reject login
          await audit({
            userId: user._id,
            action: 'LOGIN_DEVICE_BLOCKED',
            resource: 'User',
            details: { deviceName: deviceInfo.name, fingerprint, maxDevices },
            req, success: false
          });
          return res.status(403).json({
            error:   'Device limit reached',
            code:    'DEVICE_LIMIT_REACHED',
            message: `This account allows ${maxDevices} device${maxDevices===1?'':'s'}. Your device is not authorized. Ask your admin to reset the device.`,
            maxDevices,
            devices: activeSessions.map(s => ({
              deviceName: s.deviceName,
              ip:         s.ip,
              lastSeen:   s.lastSeen
            }))
          });
        }
      }

      user.lastLoginAt = new Date();
      await user.save();

      const accessToken  = signAccess(user);
      const refreshToken = signRefresh(user);
      const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await Session.create({
        userId:            user._id,
        refreshToken,
        deviceFingerprint: fingerprint,
        deviceName:        deviceInfo.name,
        deviceInfo,
        ip:                req.ip,
        expiresAt:         exp,
        lastSeen:          new Date()
      });

      // Set httpOnly refresh cookie
      res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTS);

      await audit({ userId: user._id, action: 'LOGIN', resource: 'User', details: { deviceName: deviceInfo.name }, req });

      const subInfo = sub ? {
        plan:          sub.plan,
        status:        sub.status,
        daysRemaining: sub.daysRemaining,
        trialEndsAt:   sub.trialEndsAt,
        currentPeriodEnd: sub.currentPeriodEnd
      } : null;

      res.json({
        accessToken,  // Only access token in body — refresh token in httpOnly cookie
        user:         { id: user._id, email: user.email, name: user.name, role: user.role },
        subscription: subInfo
      });
    } catch (err) { next(err); }
  }
);

// ── Refresh token (reads from httpOnly cookie) ────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    // Read from httpOnly cookie (not body)
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      res.clearCookie(REFRESH_COOKIE, COOKIE_OPTS);
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const session = await Session.findOne({ refreshToken, revokedAt: null });
    if (!session || session.expiresAt < new Date()) {
      res.clearCookie(REFRESH_COOKIE, COOKIE_OPTS);
      return res.status(401).json({ error: 'Session expired. Please login again.' });
    }

    // ── Device fingerprint validation ─────────────────────────────────────
    const incomingFp = req.headers['x-device-id'];
    if (session.deviceFingerprint && incomingFp &&
        session.deviceFingerprint !== incomingFp) {
      // Fingerprint changed — device is different, revoke session
      session.revokedAt = new Date();
      await session.save();
      res.clearCookie(REFRESH_COOKIE, COOKIE_OPTS);
      return res.status(403).json({
        error: 'Device fingerprint mismatch. Please login again.',
        code:  'DEVICE_NOT_AUTHORIZED'
      });
    }

    const user = await User.findOne({ _id: decoded.id, deletedAt: null, isActive: true });
    if (!user) {
      res.clearCookie(REFRESH_COOKIE, COOKIE_OPTS);
      return res.status(401).json({ error: 'User not found' });
    }

    // Rotate refresh token
    session.revokedAt = new Date();
    await session.save();

    const newAccess  = signAccess(user);
    const newRefresh = signRefresh(user);
    const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await Session.create({
      userId:            user._id,
      refreshToken:      newRefresh,
      deviceFingerprint: session.deviceFingerprint,
      deviceName:        session.deviceName,
      deviceInfo:        session.deviceInfo,
      ip:                req.ip,
      expiresAt:         exp,
      lastSeen:          new Date()
    });

    // Update cookie with new refresh token
    res.cookie(REFRESH_COOKIE, newRefresh, COOKIE_OPTS);

    res.json({
      accessToken:  newAccess,
      user: { id: user._id, email: user.email, name: user.name, role: user.role }
    });
  } catch (err) { next(err); }
});

// ── Logout (clears cookie + revokes session) ──────────────────────────────────
router.post('/logout', protect, async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (refreshToken) {
      await Session.findOneAndUpdate({ refreshToken }, { revokedAt: new Date() });
    }
    if (req.query.all === 'true') {
      await Session.updateMany({ userId: req.user.id, revokedAt: null }, { revokedAt: new Date() });
    }
    res.clearCookie(REFRESH_COOKIE, COOKIE_OPTS);
    await audit({ userId: req.user.id, action: 'LOGOUT', resource: 'User', req });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Get current user ──────────────────────────────────────────────────────────
router.get('/me', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({ user });
  } catch (err) { next(err); }
});

// ── Change password ───────────────────────────────────────────────────────────
router.put('/password', protect,
  [ body('currentPassword').notEmpty(), body('newPassword').isLength({ min: 8 }) ],
  validate,
  async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id).select('+passwordHash');
      if (!(await user.checkPassword(req.body.currentPassword))) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
      user.passwordHash = await User.hashPassword(req.body.newPassword);
      await user.save();
      await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
      res.clearCookie(REFRESH_COOKIE, COOKIE_OPTS);
      await audit({ userId: user._id, action: 'PASSWORD_CHANGED', resource: 'User', req });
      res.json({ success: true, message: 'Password changed. Please login again.' });
    } catch (err) { next(err); }
  }
);

module.exports = router;
