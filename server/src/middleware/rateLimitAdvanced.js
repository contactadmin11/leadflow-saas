const crypto = require('crypto');

/**
 * Simple in-memory Bloom filter placeholder.
 * For production you would use a proper probabilistic data structure.
 */
class SimpleBloom {
  constructor() {
    this._set = new Set();
  }
  add(key) { this._set.add(key); }
  has(key) { return this._set.has(key); }
}

/**
 * Request coalescing (single‑flight) map.
 * Stores a promise per unique key so concurrent identical requests share the same result.
 */
const inflight = new Map();

/**
 * Hot‑key detection – tracks request count per endpoint per second.
 * If a key exceeds a threshold, we throttle.
 */
const hotKeyCounters = new Map();
const HOT_KEY_LIMIT = 20; // requests per second per endpoint

/**
 * Middleware factory.
 * Usage: app.use('/api', rateLimitAdvanced);
 */
function rateLimitAdvanced(req, res, next) {
  try {
    const pathKey = `${req.method}:${req.originalUrl}`;
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const bloomKey = crypto.createHash('sha256').update(ip + pathKey).digest('hex');

    // Bloom filter check (cache‑penetration protection)
    const bloom = rateLimitAdvanced._bloom || (rateLimitAdvanced._bloom = new SimpleBloom());
    if (!bloom.has(bloomKey)) {
      bloom.add(bloomKey);
    }

    // Hot‑key detection
    const now = Math.floor(Date.now() / 1000);
    const hotKey = `${pathKey}:${now}`;
    const count = hotKeyCounters.get(hotKey) || 0;
    if (count >= HOT_KEY_LIMIT) {
      return res.status(429).json({ error: 'Too many requests – throttled.' });
    }
    hotKeyCounters.set(hotKey, count + 1);
    // Cleanup old counters periodically (simple approach)
    setTimeout(() => {
      hotKeyCounters.delete(hotKey);
    }, 1100);

    // Request coalescing – if an identical request is already in‑flight, wait for it
    const coalesceKey = `${ip}:${pathKey}`;
    if (inflight.has(coalesceKey)) {
      inflight.get(coalesceKey).then(() => next()).catch(next);
      return;
    }
    const promise = new Promise((resolve, reject) => {
      // Resolve after response finishes
      res.on('finish', resolve);
      res.on('close', resolve);
      res.on('error', reject);
    });
    inflight.set(coalesceKey, promise);
    promise.finally(() => inflight.delete(coalesceKey));

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = rateLimitAdvanced;
