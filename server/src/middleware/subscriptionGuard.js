/**
 * Subscription Guard Middleware
 * Checks that the logged-in user has an active subscription.
 * Applied to all data routes — not auth routes.
 */
const Subscription = require('../models/Subscription');
const logger       = require('../config/logger');

const GRACE_DAYS = 3; // days after expiry before hard block

const subscriptionGuard = async (req, res, next) => {
  // Skip subscription check for these routes
  const openPaths = [
    '/api/auth/',
    '/api/subscription/',
    '/api/admin/',
    '/health'
  ];
  if (openPaths.some(p => req.originalUrl.startsWith(p))) return next();

  try {
    const sub = await Subscription.findOne({ userId: req.user?.id });

    if (!sub) {
      return res.status(402).json({
        error: 'subscription_required',
        message: 'No subscription found. Please choose a plan.',
        redirectTo: '/pricing'
      });
    }

    const now         = new Date();
    const isTrialPlan = sub.plan === 'trial';
    const endDate     = isTrialPlan ? sub.trialEndsAt : sub.currentPeriodEnd;
    const isLifetime  = sub.plan === 'lifetime';

    if (sub.status === 'suspended') {
      return res.status(402).json({
        error: 'subscription_suspended',
        message: 'Your account has been suspended. Contact support.',
      });
    }

    if (!isLifetime && endDate) {
      const graceEnd = new Date(endDate);
      graceEnd.setDate(graceEnd.getDate() + GRACE_DAYS);

      if (now > graceEnd) {
        // Hard block after grace period
        if (sub.status === 'active') {
          sub.status = 'expired';
          await sub.save();
        }
        return res.status(402).json({
          error: 'subscription_expired',
          message: isTrialPlan
            ? 'Your 14-day free trial has ended. Subscribe to continue.'
            : 'Your subscription has expired. Renew to continue.',
          plan:          sub.plan,
          expiredAt:     endDate,
          redirectTo:    '/pricing'
        });
      }

      // Warn if expiring in ≤ 5 days (attach to response header)
      const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
      if (daysLeft <= 5) {
        res.setHeader('X-Sub-Expiring-In', daysLeft);
      }
    }

    // Attach subscription info to request for use in routes
    req.subscription = sub;
    next();
  } catch (err) {
    logger.error('[subscriptionGuard] Error:', err.message);
    next(); // On error, don't block — fail open (better UX)
  }
};

module.exports = { subscriptionGuard };
