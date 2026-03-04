'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const { connectDB } = require('./config/db');
const authRouter = require('./routes/auth');
const userRouter = require('./routes/user');
const syncRouter = require('./routes/sync');
const paymentsRouter = require('./routes/payments');
const adminRouter = require('./routes/admin');

const app = express();

// ── CORS ───────────────────────────────────────────────────────────────────────
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
);

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests with no Origin (same-origin, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.size === 0 || allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
  })
);

// ── Body parsers ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Trust proxy (for accurate IP behind nginx/load-balancer) ──────────────────
app.set('trust proxy', 1);

// ── CSRF protection ────────────────────────────────────────────────────────────
// For state-modifying requests that carry cookies, require either:
//   1. A valid Authorization: Bearer token (set by JS — cannot be forged by HTML forms), OR
//   2. An X-Requested-With header (not sent by browser-native form/image requests), OR
//   3. A Content-Type of application/json (HTML forms cannot set this).
// Together these mitigate cross-site request forgery without a separate CSRF token.
app.use((req, res, next) => {
  const method = req.method.toUpperCase();
  // Only enforce on state-changing requests that may arrive without a custom header
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();

  // If the request provides a Bearer token it is inherently CSRF-safe
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return next();

  // Accept requests that set X-Requested-With (e.g. Axios, fetch with custom headers)
  if (req.headers['x-requested-with']) return next();

  // Accept requests with a JSON Content-Type (browser forms cannot set this)
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.startsWith('application/json')) return next();

  // If an Origin is present it must be in the allowed list (already enforced by CORS,
  // but belt-and-suspenders check here)
  const origin = req.headers.origin;
  if (origin) {
    if (allowedOrigins.size === 0 || allowedOrigins.has(origin)) return next();
    return res.status(403).json({ error: 'Forbidden: CSRF origin check failed' });
  }

  // Requests with no Origin and no custom header from an untrusted context
  // are rejected on state-modifying routes.
  return res.status(403).json({ error: 'Forbidden: CSRF check failed' });
});

// ── Global rate limiter ────────────────────────────────────────────────────────
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' },
  })
);

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/api/sync', syncRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/admin', adminRouter);

// ── 404 handler ────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ──────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({ error: `${field} is already taken` });
  }
  res.status(500).json({ error: 'Internal server error' });
});

// ── Bootstrap ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

(async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`[server] Cipher Music backend running on port ${PORT}`);
  });
})().catch((err) => {
  console.error('[fatal] Could not start server:', err.message);
  process.exit(1);
});

module.exports = app; // for testing
