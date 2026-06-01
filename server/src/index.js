require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const xss        = require('xss-clean');
const hpp        = require('hpp');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const mongoose   = require('mongoose');
const path       = require('path');
const fs         = require('fs');

const logger          = require('./config/logger');
const authRoutes      = require('./routes/auth.routes');
const leadsRoutes     = require('./routes/leads.routes');
const contactsRoutes  = require('./routes/contacts.routes');
const clientsRoutes   = require('./routes/clients.routes');
const productsRoutes  = require('./routes/products.routes');
const quotesRoutes    = require('./routes/quotes.routes');
const invoicesRoutes  = require('./routes/invoices.routes');
const paymentsRoutes  = require('./routes/payments.routes');
const activitiesRoutes= require('./routes/activities.routes');
const templatesRoutes = require('./routes/templates.routes');
const automationRoutes= require('./routes/automation.routes');
const messengerRoutes = require('./routes/messenger.routes');
const aiRoutes        = require('./routes/ai.routes');
const settingsRoutes  = require('./routes/settings.routes');
const reportsRoutes   = require('./routes/reports.routes');
const adminRoutes     = require('./routes/admin.routes');
const migrateRoutes   = require('./routes/migrate.routes');
const onboardingRoutes = require('./routes/onboarding.routes');
const waRoutes        = require('./routes/wa.routes');
const { errorHandler } = require('./middleware/errorHandler');
const { verifyAppSecret, originGuard } = require('./middleware/protect');
const { protect }       = require('./middleware/auth');
const { subscriptionGuard } = require('./middleware/subscriptionGuard');
const subscriptionRoutes = require('./routes/subscription.routes');

const app = express();

// ── Security middleware ────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // disabled for API server
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// ── CORS ──────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5500')
  .split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
      return cb(null, true);
    }
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// ── Cookie parser (for httpOnly refresh token cookies) ───────────────────────
app.use(cookieParser());

// ── Body parsing ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Data sanitization ─────────────────────────────────────────────────────
app.use(mongoSanitize());   // NoSQL injection
app.use(xss());             // XSS
app.use(hpp());             // HTTP parameter pollution

// ── Request logging ───────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { stream: { write: m => logger.info(m.trim()) } }));
}

// ── IP Protection (origin guard + app secret) ────────────────────────────
app.use('/api', originGuard);  // block unauthorized domains in production
// Note: verifyAppSecret is opt-in; enable in production by setting APP_SECRET in .env
// app.use('/api', verifyAppSecret);

// ── Global rate limit ─────────────────────────────────────────────────────
app.use('/api', rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      Number(process.env.RATE_LIMIT_MAX) || 200,
  message:  { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
}));

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ── API Routes ────────────────────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/subscription', subscriptionRoutes);

// All routes below require: (1) valid JWT, (2) active subscription
app.use('/api/leads',      protect, subscriptionGuard, leadsRoutes);
app.use('/api/contacts',   protect, subscriptionGuard, contactsRoutes);
app.use('/api/clients',    protect, subscriptionGuard, clientsRoutes);
app.use('/api/products',   protect, subscriptionGuard, productsRoutes);
app.use('/api/quotes',     protect, subscriptionGuard, quotesRoutes);
app.use('/api/invoices',   protect, subscriptionGuard, invoicesRoutes);
app.use('/api/payments',   protect, subscriptionGuard, paymentsRoutes);
app.use('/api/activities', protect, subscriptionGuard, activitiesRoutes);
app.use('/api/templates',  protect, subscriptionGuard, templatesRoutes);
app.use('/api/automation', protect, subscriptionGuard, automationRoutes);
app.use('/api/onboarding', protect, subscriptionGuard, onboardingRoutes);
app.use('/api/send',       protect, subscriptionGuard, messengerRoutes);
app.use('/api/ai',         protect, subscriptionGuard, aiRoutes);
app.use('/api/settings',   protect, subscriptionGuard, settingsRoutes);
app.use('/api/reports',    protect, subscriptionGuard, reportsRoutes);
app.use('/api/admin',      adminRoutes);
app.use('/api/migrate',    protect, subscriptionGuard, migrateRoutes);
app.use('/api/wa',         protect, subscriptionGuard, waRoutes);

// ── Resolve client path FIRST — before any route that uses it ─────────────
// Try cwd-relative path first (Docker: /app/client), then __dirname-relative (local dev)
let clientPath = path.join(process.cwd(), 'client');
if (!fs.existsSync(clientPath)) {
  clientPath = path.join(__dirname, '..', '..', 'client');
}

// ── Admin Panel HTML — only accessible via secret URL token ──────────────
// Direct access to /admin.html is BLOCKED — must use /admin?t=<token>
app.get(['/admin.html', '/admin'], (req, res) => {
  const ADMIN_SECRET_PREFIX = (process.env.ADMIN_JWT_SECRET || '').substring(0, 12);
  const providedToken = req.query.t || '';
  if (!providedToken || providedToken !== ADMIN_SECRET_PREFIX) {
    return res.status(403).send('<h2 style="font-family:sans-serif;color:#dc2626;padding:40px">403 Forbidden — Access Denied</h2>');
  }
  const filePath = path.join(clientPath, 'admin.html');
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  // Fallback: check root admin.html
  const rootAdmin = path.join(__dirname, '..', '..', 'admin.html');
  if (fs.existsSync(rootAdmin)) return res.sendFile(rootAdmin);
  return res.status(404).send('Admin panel not found');
});

// ── Serve frontend — inject APP_SECRET at serve time ─────────────────────────
if (fs.existsSync(clientPath)) {
  const APP_SECRET = process.env.APP_SECRET || '';

  // Serve all static assets (JS, CSS, images) without index
  app.use(express.static(clientPath, { index: false }));

  // Helper: inject secret into any HTML file
  const serveHtml = (filename) => (req, res) => {
    const filePath = path.join(clientPath, filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('Page not found');
    let html = fs.readFileSync(filePath, 'utf-8');
    html = html.replace("window.__APP_SECRET__ || ''", `'${APP_SECRET}'`);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  };

  // Landing/marketing page at root
  app.get('/', serveHtml('landing.html'));
  app.get('/landing.html', serveHtml('landing.html'));

  // CRM app (requires login + subscription)
  app.get('/app', serveHtml('index.html'));
  app.get('/index.html', serveHtml('index.html'));

  // Migration tool
  app.get('/migrate', serveHtml('migrate.html'));
  app.get('/migrate.html', serveHtml('migrate.html'));

  logger.info(`📁 Serving frontend from ${clientPath}`);
}

// ── Catch-all — send landing page, 404 for unknown API ───────────────────
app.use('*', (req, res) => {
  if (req.originalUrl.startsWith('/api')) {
    return res.status(404).json({ error: 'Route not found' });
  }
  const landingPath = path.join(clientPath, 'landing.html');
  if (fs.existsSync(landingPath)) return res.sendFile(landingPath);
  res.status(404).send('Not found');
});

// ── Global error handler ──────────────────────────────────────────────────
app.use(errorHandler);

// ── Connect to MongoDB FIRST, then start server ──────────────────────────
const PORT = process.env.PORT || 3001;

async function startApp() {
  // 1. Connect to MongoDB with proper timeout and retry
  if (process.env.MONGODB_URI && !process.env.MONGODB_URI.includes('YOUR_USERNAME')) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 30000,  // Wait up to 30s for MongoDB (Render cold start)
        socketTimeoutMS: 45000,
        connectTimeoutMS: 30000,
        maxPoolSize: 10,
        retryWrites: true,
        retryReads: true
      });
      logger.info('✅ MongoDB connected: ' + mongoose.connection.name);
    } catch (err) {
      logger.error('❌ MongoDB connection failed:', err.message);
      logger.warn('⚠️  Server starting without DB. Will retry on first request.');
    }
  } else {
    logger.warn('⚠️  MONGODB_URI not configured. Set it in server/.env');
  }

  // 2. Start HTTP server AFTER DB connection
  const server = app.listen(PORT, () => {
    logger.info(`🚀 LeadFlow Server running on port ${PORT}`);
    logger.info(`   Environment : ${process.env.NODE_ENV || 'development'}`);
    logger.info(`   Health:       http://localhost:${PORT}/health`);
    logger.info(`   App:          http://localhost:${PORT}`);
  });

  // 3. Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down...');
    server.close(() => {
      mongoose.connection.close();
      process.exit(0);
    });
  });
}

startApp().catch(err => {
  logger.error('Fatal startup error:', err);
  process.exit(1);
});

module.exports = app;

