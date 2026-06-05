/**
 * Cache Protection Middleware
 * ═══════════════════════════════════════════════════════════════
 * Implements three cache protection patterns:
 *
 * 1. BLOOM FILTER — Cache Penetration Protection
 *    Rejects requests for keys that definitely don't exist,
 *    preventing database overload from targeted attacks.
 *
 * 2. REQUEST COALESCING (Single-Flight) — Thundering Herd Protection
 *    When multiple requests arrive for the same missing cache key,
 *    only ONE query goes to the database. All others wait and receive
 *    the same result.
 *
 * 3. HOT KEY PROTECTION — Local replica cache
 *    Keys receiving very high traffic are replicated in fast local memory
 *    with short TTL to prevent a single Redis key from becoming a bottleneck.
 * ═══════════════════════════════════════════════════════════════
 */

// ── Bloom Filter Implementation ────────────────────────────────────────────
// Simple in-process Bloom Filter using multiple hash functions and a bit array.
// No external dependency required.
class BloomFilter {
  constructor(size = 100000, hashCount = 5) {
    this.size      = size;
    this.hashCount = hashCount;
    this.bitArray  = new Uint8Array(Math.ceil(size / 8));
    this.count     = 0; // tracked insertions (approximate)
  }

  // Polynomial rolling hash with different seeds
  _hash(key, seed) {
    let hash = seed;
    for (let i = 0; i < key.length; i++) {
      hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
    }
    return hash % this.size;
  }

  _setBit(pos) {
    this.bitArray[Math.floor(pos / 8)] |= (1 << (pos % 8));
  }

  _getBit(pos) {
    return (this.bitArray[Math.floor(pos / 8)] >> (pos % 8)) & 1;
  }

  /**
   * Insert a key into the Bloom Filter.
   * Call this when a record is created/confirmed to exist in the database.
   */
  add(key) {
    const seeds = [7, 13, 31, 53, 97];
    for (let i = 0; i < this.hashCount; i++) {
      this._setBit(this._hash(key, seeds[i % seeds.length]));
    }
    this.count++;
  }

  /**
   * Check whether a key might exist.
   * Returns:
   *   false → key DEFINITELY does not exist (safe to reject)
   *   true  → key MIGHT exist (proceed to cache/DB)
   */
  mightExist(key) {
    const seeds = [7, 13, 31, 53, 97];
    for (let i = 0; i < this.hashCount; i++) {
      if (!this._getBit(this._hash(key, seeds[i % seeds.length]))) {
        return false; // Definitely does NOT exist
      }
    }
    return true; // Might exist
  }
}

// ── Request Coalescing (Single-Flight Map) ─────────────────────────────────
// Ensures only one concurrent database query per unique cache key.
const inflightMap = new Map(); // key → Promise

/**
 * Execute a database fetch with single-flight coalescing.
 * If a fetch is already in progress for the same key, wait for it.
 *
 * @param {string} key     - Unique cache key (e.g. 'user:123')
 * @param {Function} fetchFn - Async function to fetch data from DB
 * @returns {Promise<any>}
 */
async function singleFlight(key, fetchFn) {
  // If a fetch is already in-flight for this key, wait for it
  if (inflightMap.has(key)) {
    return inflightMap.get(key);
  }

  // Start a new fetch and register it so others can coalesce
  const promise = fetchFn().finally(() => {
    inflightMap.delete(key);
  });

  inflightMap.set(key, promise);
  return promise;
}

// ── Hot Key Local Replica Cache ────────────────────────────────────────────
// Tracks per-key access counts. When a key crosses the hot threshold,
// it's stored in a fast in-process cache with a very short TTL.
const HOT_KEY_THRESHOLD = 100;  // requests per window before considering it "hot"
const HOT_KEY_TTL_MS    = 3000; // local replica TTL: 3 seconds
const ACCESS_WINDOW_MS  = 1000; // count window: 1 second

const accessCounts = new Map(); // key → { count, windowStart }
const hotKeyCache  = new Map(); // key → { value, expiresAt }

/**
 * Increment access count for a key. Returns true if this key is "hot".
 */
function trackAccess(key) {
  const now = Date.now();
  if (!accessCounts.has(key)) {
    accessCounts.set(key, { count: 1, windowStart: now });
    return false;
  }
  const entry = accessCounts.get(key);
  if (now - entry.windowStart > ACCESS_WINDOW_MS) {
    // Reset window
    entry.count = 1;
    entry.windowStart = now;
    return false;
  }
  entry.count++;
  return entry.count > HOT_KEY_THRESHOLD;
}

/**
 * Fetch a value with hot-key protection.
 * If the key is hot, serve from local replica (avoid hammering Redis/DB).
 * Otherwise, fetch normally and optionally cache locally if access is high.
 *
 * @param {string}   key     - Cache key
 * @param {Function} fetchFn - Async function that fetches the real value
 * @returns {Promise<any>}
 */
async function hotKeyGet(key, fetchFn) {
  const now = Date.now();

  // Serve from hot-key replica cache if available and not expired
  const hotEntry = hotKeyCache.get(key);
  if (hotEntry && hotEntry.expiresAt > now) {
    return hotEntry.value;
  }

  const isHot = trackAccess(key);
  const value = await fetchFn();

  // Cache locally if hot
  if (isHot && value !== null && value !== undefined) {
    hotKeyCache.set(key, { value, expiresAt: now + HOT_KEY_TTL_MS });
    // Schedule cleanup
    setTimeout(() => hotKeyCache.delete(key), HOT_KEY_TTL_MS + 100);
  }

  return value;
}

// ── Main export: Per-user subscription status with full protection ──────────
// This wraps the subscription lookup used by subscriptionGuard
// with all three protection layers.
const Subscription = require('../models/Subscription');

// Bloom filter: pre-populated with known user IDs on startup
// and updated whenever a new subscription is created.
const subscriptionBloom = new BloomFilter(500000, 5);

// Keep track of IDs we've already loaded (avoids duplicate DB bootstrap)
let bloomBootstrapped = false;

/**
 * Bootstrap Bloom Filter from the database on first use.
 * After this, new IDs are added incrementally.
 */
async function bootstrapBloom() {
  if (bloomBootstrapped) return;
  bloomBootstrapped = true;
  try {
    // Load all known userId strings from subscription collection
    const subs = await Subscription.find({}, { userId: 1, _id: 0 }).lean();
    subs.forEach(s => {
      if (s.userId) subscriptionBloom.add(s.userId.toString());
    });
  } catch (e) {
    // Non-fatal — Bloom Filter will just miss initially
    console.warn('[CacheProtection] Bloom bootstrap failed:', e.message);
    bloomBootstrapped = false;
  }
}

/**
 * Register a new user ID in the Bloom Filter.
 * Call this after a new subscription record is created.
 */
function registerSubscription(userId) {
  subscriptionBloom.add(userId.toString());
}

/**
 * Fetch a subscription with all three protections:
 * 1. Bloom Filter (cache penetration)
 * 2. Single-flight (thundering herd)
 * 3. Hot key local replica
 */
async function getSubscriptionProtected(userId) {
  await bootstrapBloom();

  const userIdStr = userId.toString();

  // 1. Bloom Filter check — reject definitely non-existent users
  if (!subscriptionBloom.mightExist(userIdStr)) {
    return null; // Definitely not in DB — reject without querying
  }

  // 2 + 3. Single-flight + Hot-key protection combined
  const cacheKey = `sub:${userIdStr}`;
  return hotKeyGet(cacheKey, () =>
    singleFlight(cacheKey, () =>
      Subscription.findOne({ userId }).lean()
    )
  );
}

// Periodically clean up old access count entries to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of accessCounts.entries()) {
    if (now - entry.windowStart > ACCESS_WINDOW_MS * 5) {
      accessCounts.delete(key);
    }
  }
}, 30000); // every 30 seconds

module.exports = {
  BloomFilter,
  singleFlight,
  hotKeyGet,
  trackAccess,
  getSubscriptionProtected,
  registerSubscription,
  subscriptionBloom
};
