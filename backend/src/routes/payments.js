'use strict';

const { Router } = require('express');
const Payment = require('../models/Payment');
const User = require('../models/User');
const auth = require('../middleware/auth');
const maintenanceMode = require('../middleware/maintenance');

const router = Router();
router.use(auth);
router.use(maintenanceMode);

// ── GET /payments ─── list current user's payments ────────────────────────────
router.get('/', async (req, res) => {
  const payments = await Payment.find({ userId: req.user.sub })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return res.json({ payments });
});

// ── GET /payments/:id ──────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const payment = await Payment.findOne({ _id: req.params.id, userId: req.user.sub }).lean();
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  return res.json({ payment });
});

module.exports = router;
