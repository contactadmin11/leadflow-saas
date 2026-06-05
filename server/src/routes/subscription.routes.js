/**
 * Subscription + Payment Routes (Razorpay)
 * ══════════════════════════════════════════
 * Plans:
 *   trial    → 7 days free (auto-created on register)
 *   monthly  → ₹499 / month
 *   quarterly→ ₹1299 / quarter
 *   yearly   → ₹3999 / year
 *
 * Flow:
 *   1. POST /api/subscription/create-order  → Razorpay order
 *   2. Frontend pays with Razorpay SDK
 *   3. POST /api/subscription/verify         → verify + activate
 *   4. POST /api/subscription/webhook        → auto-renewal (Razorpay events)
 */
const express      = require('express');
const crypto       = require('crypto');
const Subscription = require('../models/Subscription');
const User         = require('../models/User');
const { protect }  = require('../middleware/auth');
const { audit }    = require('../services/audit.service');
const logger       = require('../config/logger');
const { registerSubscription } = require('../middleware/cacheProtection');
const router       = express.Router();

// ── Plan config ────────────────────────────────────────────────────────────
const PLANS = {
  monthly:   { amount: 29900,  months: 1,  label: '₹299 / Month'    },
  quarterly: { amount: 74900, months: 3,  label: '₹749 / Quarter' },
  yearly:    { amount: 290000, months: 12, label: '₹2,900 / Year'    }
};
const TRIAL_DAYS = 7;
const CURRENCY   = 'INR';

// ── Lazy-load Razorpay (only if credentials are set) ──────────────────────
let razorpay = null;
function getRazorpay() {
  if (razorpay) return razorpay;
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  const Razorpay = require('razorpay');
  razorpay = new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
  return razorpay;
}

// ── GET current subscription status ───────────────────────────────────────
router.get('/status', protect, async (req, res, next) => {
  try {
    let sub = await Subscription.findOne({ userId: req.user.id });
    if (!sub) {
      // Auto-create trial if missing
      sub = await _createTrial(req.user.id);
    }
    res.json({
      plan:          sub.plan,
      status:        sub.status,
      isActive:      sub.isActive,
      daysRemaining: sub.daysRemaining,
      trialEndsAt:   sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
      payments:      sub.payments?.length || 0
    });
  } catch (err) { next(err); }
});

// ── GET plans & Razorpay key ───────────────────────────────────────────────
router.get('/plans', (req, res) => {
  res.json({
    plans: PLANS,
    razorpayKey: process.env.RAZORPAY_KEY_ID || null,
    currency: CURRENCY,
    trialDays: TRIAL_DAYS
  });
});

// ── POST create Razorpay order ─────────────────────────────────────────────
router.post('/create-order', protect, async (req, res, next) => {
  try {
    const { plan } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

    const rzp = getRazorpay();
    if (!rzp) return res.status(503).json({ error: 'Payment gateway not configured' });

    const planConfig = PLANS[plan];
    const order = await rzp.orders.create({
      amount:          planConfig.amount,
      currency:        CURRENCY,
      receipt:         `lf_${req.user.id}_${Date.now()}`,
      notes: {
        userId:  req.user.id.toString(),
        plan,
        email:   req.user.email
      }
    });

    logger.info(`[Subscription] Order created: ${order.id} for user ${req.user.id} plan ${plan}`);
    res.json({ orderId: order.id, amount: planConfig.amount, currency: CURRENCY, plan, label: planConfig.label });
  } catch (err) { next(err); }
});

// ── POST verify payment + activate subscription ────────────────────────────
router.post('/verify', protect, async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification data missing' });
    }

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSig !== razorpay_signature) {
      logger.warn(`[Subscription] Invalid signature for order ${razorpay_order_id}`);
      return res.status(400).json({ error: 'Payment verification failed. Contact support.' });
    }

    const planConfig = PLANS[plan];
    if (!planConfig) return res.status(400).json({ error: 'Invalid plan' });

    // Activate subscription
    const now   = new Date();
    const end   = new Date(now);
    if (plan === 'lifetime') {
      end.setFullYear(end.getFullYear() + 100);
    } else {
      end.setMonth(end.getMonth() + planConfig.months);
    }

    const sub = await Subscription.findOneAndUpdate(
      { userId: req.user.id },
      {
        $set: {
          plan,
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd:   end,
          rzpPaymentId:       razorpay_payment_id,
          rzpOrderId:         razorpay_order_id
        },
        $push: {
          payments: {
            amount:       planConfig.amount / 100,
            currency:     CURRENCY,
            plan,
            paidAt:       now,
            rzpPaymentId: razorpay_payment_id,
            rzpOrderId:   razorpay_order_id,
            months:       planConfig.months
          }
        }
      },
      { new: true, upsert: true }
    );

    await audit({
      userId: req.user.id,
      action: 'SUBSCRIPTION_ACTIVATED',
      resource: 'Subscription',
      details: { plan, amount: planConfig.amount / 100, paymentId: razorpay_payment_id }
    });

    logger.info(`[Subscription] ✅ Activated ${plan} for user ${req.user.id}`);
    res.json({
      success: true,
      plan,
      label:   planConfig.label,
      validUntil: end,
      message: `🎉 ${planConfig.label} activated successfully!`
    });
  } catch (err) { next(err); }
});

// ── POST Razorpay webhook (auto-renewal notifications) ─────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig  = req.headers['x-razorpay-signature'];
    const body = req.body.toString();
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || '')
      .update(body)
      .digest('hex');

    if (sig !== expected) {
      logger.warn('[Webhook] Invalid Razorpay signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(body);
    logger.info(`[Webhook] Razorpay event: ${event.event}`);

    if (event.event === 'payment.captured') {
      // Auto-process successful payment
      const notes = event.payload?.payment?.entity?.notes;
      const plan  = notes?.plan;
      const userId= notes?.userId;
      if (userId && plan && PLANS[plan]) {
        const planConfig = PLANS[plan];
        const now = new Date();
        const end = new Date(now);
        end.setMonth(end.getMonth() + planConfig.months);
        await Subscription.findOneAndUpdate(
          { userId },
          {
            $set:  { plan, status: 'active', currentPeriodStart: now, currentPeriodEnd: end },
            $push: { payments: { amount: planConfig.amount / 100, plan, paidAt: now, months: planConfig.months } }
          },
          { upsert: true }
        );
        logger.info(`[Webhook] Auto-activated ${plan} for user ${userId}`);
      }
    }

    res.json({ received: true });
  } catch (err) {
    logger.error('[Webhook] Error:', err.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ── GET billing history ───────────────────────────────────────────────────
router.get('/billing', protect, async (req, res, next) => {
  try {
    const sub = await Subscription.findOne({ userId: req.user.id }).lean();
    res.json({ payments: sub?.payments || [], plan: sub?.plan, status: sub?.status });
  } catch (err) { next(err); }
});

// ── POST cancel subscription ──────────────────────────────────────────────
router.post('/cancel', protect, async (req, res, next) => {
  try {
    const sub = await Subscription.findOneAndUpdate(
      { userId: req.user.id },
      { $set: { status: 'cancelled', cancelledAt: new Date() } },
      { new: true }
    );
    await audit({ userId: req.user.id, action: 'SUBSCRIPTION_CANCELLED', resource: 'Subscription' });
    res.json({ success: true, message: 'Subscription cancelled. Access remains until period ends.' });
  } catch (err) { next(err); }
});

// ── ADMIN: grant free subscription ───────────────────────────────────────
router.post('/admin/grant', protect, async (req, res, next) => {
  try {
    if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { targetUserId, plan = 'monthly', months = 1 } = req.body;
    const now = new Date();
    const end = new Date(now);
    end.setMonth(end.getMonth() + parseInt(months));
    await Subscription.findOneAndUpdate(
      { userId: targetUserId },
      { $set: { plan, status: 'active', currentPeriodStart: now, currentPeriodEnd: end } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Helper: create trial subscription ─────────────────────────────────────
async function _createTrial(userId) {
  const now   = new Date();
  const end   = new Date(now);
  end.setDate(end.getDate() + TRIAL_DAYS);
  const sub = await Subscription.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId, plan: 'trial', status: 'active', trialStartAt: now, trialEndsAt: end } },
    { new: true, upsert: true }
  );
  // Phase 1: Register in Bloom Filter so cache penetration protection allows this user
  registerSubscription(userId);
  return sub;
}

// ── GET my active devices ─────────────────────────────────────────────────
const Session = require('../models/Session');

router.get('/devices', protect, async (req, res, next) => {
  try {
    const sessions = await Session.find({
      userId:    req.user.id,
      revokedAt: null,
      expiresAt: { $gt: new Date() }
    }).select('deviceName deviceInfo ip lastSeen createdAt').lean();

    const sub = await Subscription.findOne({ userId: req.user.id }).lean();

    res.json({
      devices:    sessions,
      maxDevices: sub?.maxDevices ?? 1,
      count:      sessions.length
    });
  } catch (err) { next(err); }
});

// ── DELETE remove a specific device (logout from it) ─────────────────────
router.delete('/devices/:sessionId', protect, async (req, res, next) => {
  try {
    const session = await Session.findOne({ _id: req.params.sessionId, userId: req.user.id });
    if (!session) return res.status(404).json({ error: 'Device session not found' });
    session.revokedAt = new Date();
    await session.save();
    await audit({ userId: req.user.id, action: 'DEVICE_REMOVED', resource: 'Session',
      details: { deviceName: session.deviceName } });
    res.json({ success: true, message: 'Device logged out' });
  } catch (err) { next(err); }
});

// Export helper for use in auth.routes.js
module.exports = router;
module.exports._createTrial = _createTrial;

