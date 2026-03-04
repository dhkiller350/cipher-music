'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const adminAuth = require('../middleware/adminAuth');
const User = require('../models/User');

const router = Router();

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests. Try again in 1 minute.' },
});

// All routes require admin authentication and rate limiting
router.use(adminLimiter);
router.use(adminAuth);

// ── POST /maintenance/on ───────────────────────────────────────────────────────
router.post('/maintenance/on', async (_req, res) => {
  // Persist maintenance state via the Config model (imported lazily to avoid
  // circular-dependency issues when this file is used standalone).
  try {
    const Config = require('../src/models/Config');
    await Config.set('platform_status', 'maintenance', 'admin-route');
  } catch {
    // Config model may not be available in all deployments — continue
  }
  return res.json({ message: 'Maintenance mode enabled', maintenance: true });
});

// ── POST /maintenance/off ──────────────────────────────────────────────────────
router.post('/maintenance/off', async (_req, res) => {
  try {
    const Config = require('../src/models/Config');
    await Config.set('platform_status', 'active', 'admin-route');
  } catch {
    // Config model may not be available
  }
  return res.json({ message: 'Maintenance mode disabled', maintenance: false });
});

// ── POST /users/ban/:id ────────────────────────────────────────────────────────
router.post('/users/ban/:id', async (req, res) => {
  const { reason } = req.body;
  const update = { banned: true };
  if (reason) update.banReason = reason;

  const user = await User.findByIdAndUpdate(
    req.params.id,
    update,
    { new: true }
  ).select('-passwordHash');

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.json({ message: 'User banned', user });
});

// ── POST /payments/approve/:id ─────────────────────────────────────────────────
router.post('/payments/approve/:id', async (req, res) => {
  try {
    const Payment = require('../src/models/Payment');
    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    payment.setStatus('succeeded', 'Approved by admin');
    await payment.save();
    return res.json({ message: 'Payment approved', payment });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
