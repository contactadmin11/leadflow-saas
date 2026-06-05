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
  maxAge:    7 * 24 * 60 * 60 * 1000,  // 7 days in ms
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

const signRefresh = (user, expiresIn) => jwt.sign(
  { id: user._id },
  process.env.JWT_REFRESH_SECRET,
  { expiresIn: expiresIn || process.env.JWT_REFRESH_EXPIRES || '7d' }
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
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('mobile').trim().notEmpty().withMessage('Mobile number is required')
  ],
  validate,
  async (req, res, next) => {
    try {
      const { email, password, name, mobile, deviceInfo: bodyDeviceInfo } = req.body;

      // Validate mobile format
      let cleanMobile = (mobile || '').replace(/[\s\-]/g, '');
      if (cleanMobile.length < 10) return res.status(400).json({ error: 'Enter a valid mobile number (10+ digits)' });
      // Ensure +91 prefix for Indian numbers
      if (!cleanMobile.startsWith('+')) {
        if (cleanMobile.length === 10) cleanMobile = '+91' + cleanMobile;
        else cleanMobile = '+' + cleanMobile;
      }

      const exists = await User.findOne({ email });
      if (exists) return res.status(409).json({ error: 'Email already registered' });

      // Check if mobile is already used
      const mobileExists = await User.findOne({ mobile: cleanMobile, deletedAt: null });
      if (mobileExists) return res.status(409).json({ error: 'This mobile number is already registered with another account' });

      const passwordHash = await User.hashPassword(password);
      const user = await User.create({
        email, passwordHash, name,
        mobile: cleanMobile,
        authMethods: ['password']
      });

      // Create settings + 7-day trial
      await Settings.create({ userId: user._id, bizName: name, userName: name, phone: cleanMobile });
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
        accessToken,
        user: { id: user._id, email: user.email, name: user.name, role: user.role, mobile: user.mobile },
        subscription: { plan: 'trial', daysRemaining: 7 }
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
    // NOTE: We do NOT revoke sessions on fingerprint mismatch — browser
    // fingerprints can change slightly between page loads (OS updates,
    // browser updates, etc). Revoking here was causing users to be
    // repeatedly logged out. Instead we just update the stored fingerprint.
    const incomingFp = req.headers['x-device-id'];
    if (incomingFp && session.deviceFingerprint !== incomingFp) {
      session.deviceFingerprint = incomingFp; // update silently
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
    const remainingSecs = Math.max(1, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
    const newRefresh = signRefresh(user, remainingSecs);

    await Session.create({
      userId:            user._id,
      refreshToken:      newRefresh,
      deviceFingerprint: session.deviceFingerprint,
      deviceName:        session.deviceName,
      deviceInfo:        session.deviceInfo,
      ip:                req.ip,
      expiresAt:         session.expiresAt,
      lastSeen:          new Date()
    });

    // Update cookie with new refresh token and proper remaining maxAge
    res.cookie(REFRESH_COOKIE, newRefresh, {
      ...COOKIE_OPTS,
      maxAge: Math.max(0, new Date(session.expiresAt).getTime() - Date.now())
    });

    res.json({
      accessToken:  newAccess,
      user: { id: user._id, email: user.email, name: user.name, role: user.role }
    });
  } catch (err) { next(err); }
});

// ── OTP Login (Firebase Phone Auth) ──────────────────────────────────────────
const axios = require('axios');
const crypto = require('crypto');

router.post('/otp/login',
  authLimiter,
  [ body('idToken').notEmpty() ],
  validate,
  async (req, res, next) => {
    try {
      const { idToken, deviceInfo: bodyDeviceInfo, name: bodyName } = req.body;

      // ── 1. Verify Firebase ID Token ──────────────────────────────────────
      const decodedHeader = jwt.decode(idToken, { complete: true });
      if (!decodedHeader?.header?.kid) {
        return res.status(401).json({ error: 'Invalid token format' });
      }

      const keysRes = await axios.get('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
      const publicKey = keysRes.data[decodedHeader.header.kid];
      if (!publicKey) return res.status(401).json({ error: 'Invalid token signature' });

      const decodedToken = jwt.verify(idToken, publicKey, { algorithms: ['RS256'] });

      const phone      = decodedToken.phone_number;
      const firebaseUid= decodedToken.uid;
      if (!phone) return res.status(400).json({ error: 'No phone number in token' });

      // ── 2. Find or auto-create user ───────────────────────────────────────
      let user = null;
      let isNewUser = false;

      // Priority 1: Find by firebaseUid (most reliable — survives number changes)
      if (firebaseUid) {
        user = await User.findOne({ firebaseUid, deletedAt: null });
      }

      // Priority 2: Find by exact mobile number
      if (!user) {
        // Normalise: strip spaces, ensure +91 prefix for Indian numbers
        const normPhone = phone.replace(/\s/g, '');
        user = await User.findOne({ mobile: normPhone, deletedAt: null });
      }

      // Priority 3: Auto-create a new account for first-time OTP users
      if (!user) {
        isNewUser = true;
        const autoEmail = User.mobileEmail(phone);
        const autoName  = bodyName || `User ${phone.slice(-4)}`; // e.g. "User 4321"
        // Generate a random secure password (OTP user doesn't know it — they login via OTP)
        const randomPass = await User.hashPassword(crypto.randomBytes(32).toString('hex'));

        user = await User.create({
          email:       autoEmail,
          passwordHash:randomPass,
          name:        autoName,
          mobile:      phone,
          firebaseUid: firebaseUid,
          authMethods: ['otp'],
          isActive:    true
        });
        // Create default settings + trial
        await Settings.create({ userId: user._id, phone, bizName: autoName, userName: autoName });
        await _createTrial(user._id);
        await audit({ userId: user._id, action: 'REGISTER_OTP', resource: 'User', details: { mobile: phone }, req });
      } else {
        // Link firebaseUid if not yet linked
        const updates = {};
        if (!user.firebaseUid && firebaseUid) updates.firebaseUid = firebaseUid;
        if (!user.mobile)                    updates.mobile = phone;
        if (!user.authMethods?.includes('otp')) {
          updates.$addToSet = { authMethods: 'otp' };
        }
        if (Object.keys(updates).length) await User.findByIdAndUpdate(user._id, updates);
      }

      if (!user.isActive) return res.status(403).json({ error: 'Account deactivated. Contact support.' });

      // ── 3. OTP rate-limit (3 per day) ────────────────────────────────────
      const today = new Date().toISOString().split('T')[0];
      if (user.lastOtpLoginDate === today) {
        if (user.otpLoginsToday >= 3) {
          return res.status(429).json({ error: 'Maximum 3 OTP logins per day reached. Login with password instead.' });
        }
        user.otpLoginsToday += 1;
      } else {
        user.lastOtpLoginDate = today;
        user.otpLoginsToday = 1;
      }
      user.lastLoginAt = new Date();
      await user.save();

      // ── 4. Device / session management ──────────────────────────────────
      const deviceInfo   = getDeviceInfo(req, bodyDeviceInfo);
      const fingerprint  = deviceInfo.fingerprint;

      const sub = await Subscription.findOne({ userId: user._id });
      const maxDevices = sub?.maxDevices ?? 1;

      if (!isNewUser && maxDevices !== 0 && fingerprint) {
        const activeSessions = await Session.find({ userId: user._id, revokedAt: null, expiresAt: { $gt: new Date() } });
        const isKnownDevice  = activeSessions.some(s => s.deviceFingerprint === fingerprint);
        if (!isKnownDevice && activeSessions.length >= maxDevices) {
          return res.status(403).json({
            error: `Device limit reached (${activeSessions.length}/${maxDevices}). Log out from another device first.`
          });
        }
      }

      // ── 5. Issue tokens + set cookie ─────────────────────────────────────
      const accessToken  = signAccess(user);
      const refreshToken = signRefresh(user);
      const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await Session.create({
        userId:            user._id,
        refreshToken,
        deviceFingerprint: fingerprint,
        deviceName:        deviceInfo.name,
        deviceInfo,
        ip:                req.ip,
        expiresAt:         exp
      });

      res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTS);
      await audit({ userId: user._id, action: 'LOGIN_OTP', resource: 'User', details: { mobile: phone, isNewUser }, req });

      res.json({
        accessToken,
        isNewUser,
        user: { id: user._id, email: user.email, name: user.name, role: user.role, mobile: user.mobile },
        subscription: sub ? { plan: sub.plan, daysRemaining: sub.daysRemaining } : null
      });
    } catch (err) {
      if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'OTP session expired. Please try again.' });
      next(err);
    }
  }
);

// ── Google Sign-In ─────────────────────────────────────────────────────────────
router.post('/google/login',
  authLimiter,
  [ body('idToken').notEmpty() ],
  validate,
  async (req, res, next) => {
    try {
      const { idToken, mobile: rawMobile, deviceInfo: bodyDeviceInfo } = req.body;

      // ── 1. Verify Firebase Google ID Token ───────────────────────────────
      const decodedHeader = jwt.decode(idToken, { complete: true });
      if (!decodedHeader?.header?.kid) {
        return res.status(401).json({ error: 'Invalid token format' });
      }

      // Fetch Google's public keys (try Firebase first, then standard Google OAuth)
      let publicKey;
      try {
        const keysRes = await axios.get('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
        publicKey = keysRes.data[decodedHeader.header.kid];
      } catch(e) {}

      if (!publicKey) {
        try {
          const keysRes2 = await axios.get('https://www.googleapis.com/oauth2/v1/certs');
          publicKey = keysRes2.data[decodedHeader.header.kid];
        } catch(e) {}
      }
      
      if (!publicKey) return res.status(401).json({ error: 'Invalid token signature (Key not found)' });

      const decoded = jwt.verify(idToken, publicKey, { algorithms: ['RS256'] });

      const googleUid  = decoded.uid || decoded.sub;
      const email      = decoded.email;
      const name       = decoded.name || decoded.email?.split('@')[0] || 'User';

      if (!email) return res.status(400).json({ error: 'No email in Google token' });

      // ── 2. Find existing user ────────────────────────────────────────────
      let user = null;
      let isNewUser = false;

      // Priority 1: by googleUid
      user = await User.findOne({ googleUid, deletedAt: null });

      // Priority 2: by email (user registered with email/password before)
      if (!user) {
        user = await User.findOne({ email, deletedAt: null });
      }

      // ── 3. New user — require mobile before creating account ─────────────
      if (!user) {
        // If mobile not provided yet, tell frontend to ask for it
        if (!rawMobile) {
          return res.json({ needsMobile: true, email, name });
        }

        // Validate and normalise mobile
        let mobile = (rawMobile || '').replace(/[\s\-]/g, '');
        if (mobile.length < 10) return res.status(400).json({ error: 'Enter a valid mobile number (10+ digits)' });
        
        // Prevent common fake patterns
        const repetitive = /^(\d)\1{6,}$/; 
        const sequential = /^(1234567|9876543|0123456)/;
        if(repetitive.test(mobile) || sequential.test(mobile)) {
          return res.status(400).json({ error: 'Please enter a valid real mobile number' });
        }
        if (!mobile.startsWith('+')) {
          mobile = mobile.length === 10 ? '+91' + mobile : '+' + mobile;
        }

        // Block duplicate mobile
        const mobileExists = await User.findOne({ mobile, deletedAt: null });
        if (mobileExists) return res.status(409).json({ error: 'This mobile number is already registered with another account' });

        isNewUser = true;
        user = await User.create({
          email,
          passwordHash: await User.hashPassword(require('crypto').randomBytes(32).toString('hex')),
          name,
          mobile,
          googleUid,
          authMethods: ['google'],
          isActive: true
        });
        await Settings.create({ userId: user._id, bizName: name, userName: name, phone: mobile });
        await _createTrial(user._id);
        await audit({ userId: user._id, action: 'REGISTER_GOOGLE', resource: 'User', details: { email, mobile }, req });

      } else {
        // ── 4. Existing user — link googleUid if not already linked ─────────
        const updates = {};
        if (!user.googleUid) updates.googleUid = googleUid;
        if (!user.authMethods?.includes('google')) updates.$addToSet = { authMethods: 'google' };
        if (Object.keys(updates).length) await User.findByIdAndUpdate(user._id, updates);
      }

      if (!user.isActive) return res.status(403).json({ error: 'Account deactivated. Contact support.' });

      user.lastLoginAt = new Date();
      await user.save();

      // ── 5. Issue tokens + session ────────────────────────────────────────
      const deviceInfo   = getDeviceInfo(req, bodyDeviceInfo);
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

      res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTS);
      await audit({ userId: user._id, action: 'LOGIN_GOOGLE', resource: 'User', details: { email, isNewUser }, req });

      res.json({
        accessToken,
        isNewUser,
        user: { id: user._id, email: user.email, name: user.name, role: user.role, mobile: user.mobile }
      });

    } catch (err) {
      if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Google session expired. Please sign in again.' });
      next(err);
    }
  }
);

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

// ── Update Profile (name, mobile) ─────────────────────────────────────────────
router.put('/update-profile', protect, async (req, res, next) => {
  try {
    const { name, mobile } = req.body;
    const updates = {};
    if (name   && name.trim())   updates.name   = name.trim();
    if (mobile && mobile.trim()) {
      // Store mobile normalized — strip everything except digits and leading +
      updates.mobile = mobile.trim().replace(/[^\d+]/g, '');
    }
    if (!Object.keys(updates).length) return res.json({ success: true });
    const user = await User.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true });
    await audit({ userId: user._id, action: 'PROFILE_UPDATED', resource: 'User', details: { fields: Object.keys(updates) }, req });
    res.json({ success: true, user: { id: user._id, email: user.email, name: user.name, role: user.role, mobile: user.mobile } });
  } catch (err) { next(err); }
});

module.exports = router;
