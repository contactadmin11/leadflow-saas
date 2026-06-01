/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║    LeadFlow — IP Protection Middleware                       ║
 * ║    Prevents the app from running without valid backend.      ║
 * ║    ALL business logic enforced server-side.                  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Security layers:
 * 1. Every API call requires a valid JWT (no JWT = no data)
 * 2. API secret header check (frontend must send X-App-Secret)
 * 3. Domain whitelist (only YOUR frontend can call your API)
 * 4. Rate limiting (already in index.js)
 * 5. All data in MongoDB (copying frontend gets you NOTHING)
 */

const APP_SECRET = process.env.APP_SECRET || 'leadflow-default-secret-CHANGE-ME';

/**
 * Middleware: Verify the request comes from the legitimate frontend.
 * The frontend sends X-App-Secret header with every request.
 * If the secret doesn't match, the API refuses to respond.
 * 
 * This means:
 * - Someone can copy the HTML/CSS/JS frontend
 * - BUT their copy will fail when it tries to call YOUR API
 * - Because they don't have the secret
 * - AND their backend won't have YOUR MongoDB data
 */
const verifyAppSecret = (req, res, next) => {
  // Skip for health check and admin login
  if (req.path === '/health' || req.originalUrl === '/health') return next();
  if (req.path === '/api/admin/login') return next();

  // In development, skip if no secret configured
  if (process.env.NODE_ENV === 'development' && APP_SECRET === 'leadflow-default-secret-CHANGE-ME') {
    return next();
  }

  const clientSecret = req.headers['x-app-secret'];
  if (!clientSecret || clientSecret !== APP_SECRET) {
    // Return generic 404 instead of 403 — don't reveal the API exists
    return res.status(404).json({ error: 'Not found' });
  }

  next();
};

/**
 * Middleware: Validate Origin header against whitelist.
 * In production, only requests from your deployed domain are accepted.
 * 
 * Set ALLOWED_ORIGINS in .env:
 *   ALLOWED_ORIGINS=https://yourdomain.com,https://yourapp.vercel.app
 */
const originGuard = (req, res, next) => {
  if (process.env.NODE_ENV !== 'production') return next();
  
  const origin  = req.headers.origin || req.headers.referer || '';
  const allowed = (process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || '')
    .split(',').map(o => o.trim()).filter(Boolean);

  // Always allow same-origin requests (when frontend served by backend)
  const host = req.headers.host || '';
  if (origin.includes(host)) return next();

  // Allow whitelisted origins
  if (!allowed.length || allowed.some(o => origin.startsWith(o))) return next();

  return res.status(403).json({ error: 'Forbidden' });
};

module.exports = { verifyAppSecret, originGuard };
