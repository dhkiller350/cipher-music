'use strict';

const { Router } = require('express');
const User = require('../models/User');
const Payment = require('../models/Payment');
const Config = require('../models/Config');
const { requireAdmin } = require('../middleware/admin');

const router = Router();
router.use(...requireAdmin);

// ════════════════════════════════════════════════════════════════════════════════
//  MAINTENANCE MODE
// ════════════════════════════════════════════════════════════════════════════════

// ── GET /admin/maintenance ─────────────────────────────────────────────────────
router.get('/maintenance', async (_req, res) => {
  const status = await Config.get('platform_status', 'active');
  return res.json({ maintenance: status === 'maintenance', status });
});

// ── POST /admin/maintenance ────────────────────────────────────────────────────
router.post('/maintenance', async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: '"enabled" (boolean) is required' });
  }
  const newStatus = enabled ? 'maintenance' : 'active';
  await Config.set('platform_status', newStatus, req.user.email);
  return res.json({ message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}`, status: newStatus });
});

// ════════════════════════════════════════════════════════════════════════════════
//  USER MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════════

// ── GET /admin/users ───────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  const { page = 1, limit = 20, search, banned } = req.query;
  const filter = {};
  if (search) {
    filter.$or = [
      { email: { $regex: search, $options: 'i' } },
      { username: { $regex: search, $options: 'i' } },
    ];
  }
  if (banned !== undefined) filter.banned = banned === 'true';

  const [users, total] = await Promise.all([
    User.find(filter)
      .select('-sessions -passwordHash')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean(),
    User.countDocuments(filter),
  ]);

  return res.json({ users, total, page: Number(page), limit: Number(limit) });
});

// ── GET /admin/users/:id ───────────────────────────────────────────────────────
router.get('/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id).select('-sessions -passwordHash').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ user });
});

// ── POST /admin/users/:id/ban ──────────────────────────────────────────────────
router.post('/users/:id/ban', async (req, res) => {
  const { reason } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { banned: true, banReason: reason || 'Banned by admin', sessions: [] },
    { new: true }
  ).select('-sessions -passwordHash').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ message: 'User banned', user });
});

// ── POST /admin/users/:id/unban ────────────────────────────────────────────────
router.post('/users/:id/unban', async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { banned: false, banReason: null },
    { new: true }
  ).select('-sessions -passwordHash').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ message: 'User unbanned', user });
});

// ── PATCH /admin/users/:id/subscription ───────────────────────────────────────
router.patch('/users/:id/subscription', async (req, res) => {
  const { plan, status, expiresAt } = req.body;
  const update = {};
  if (plan) update['subscription.plan'] = plan;
  if (status) update['subscription.status'] = status;
  if (expiresAt) update['subscription.expiresAt'] = new Date(expiresAt);

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $set: update },
    { new: true, runValidators: true }
  ).select('-sessions -passwordHash').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ message: 'Subscription updated', user });
});

// ── PATCH /admin/users/:id/role ────────────────────────────────────────────────
router.patch('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'role must be "user" or "admin"' });
  }
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { role },
    { new: true }
  ).select('-sessions -passwordHash').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ message: 'Role updated', user });
});

// ── DELETE /admin/users/:id ────────────────────────────────────────────────────
router.delete('/users/:id', async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  // Also delete all their payments
  await Payment.deleteMany({ userId: req.params.id });
  return res.json({ message: 'User deleted' });
});

// ════════════════════════════════════════════════════════════════════════════════
//  PAYMENT MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════════

// ── GET /admin/payments ────────────────────────────────────────────────────────
router.get('/payments', async (req, res) => {
  const { page = 1, limit = 20, status, userId } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (userId) filter.userId = userId;

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean(),
    Payment.countDocuments(filter),
  ]);

  return res.json({ payments, total, page: Number(page), limit: Number(limit) });
});

// ── GET /admin/payments/:id ────────────────────────────────────────────────────
router.get('/payments/:id', async (req, res) => {
  const payment = await Payment.findById(req.params.id).lean();
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  return res.json({ payment });
});

// ── PATCH /admin/payments/:id/status ──────────────────────────────────────────
router.patch('/payments/:id/status', async (req, res) => {
  const { status, reason } = req.body;
  const allowed = ['pending', 'succeeded', 'failed', 'refunded', 'disputed', 'canceled'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
  }

  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  payment.setStatus(status, reason || null);
  await payment.save();

  return res.json({ message: 'Payment status updated', payment });
});

// ── POST /admin/payments ── manually create a payment record ──────────────────
router.post('/payments', async (req, res) => {
  const { userId, userEmail, amount, currency, plan, billingInterval, status, notes } = req.body;
  if (!userId || !userEmail || amount === undefined || !plan) {
    return res.status(400).json({ error: 'userId, userEmail, amount, and plan are required' });
  }

  const payment = new Payment({ userId, userEmail, amount, currency, plan, billingInterval, status, notes });
  payment.statusHistory.push({ status: payment.status, changedAt: new Date(), reason: 'Created by admin' });
  await payment.save();

  return res.status(201).json({ payment });
});

// ── GET /admin/stats ───────────────────────────────────────────────────────────
router.get('/stats', async (_req, res) => {
  const [totalUsers, bannedUsers, premiumUsers, totalPayments, succeededRevenue] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ banned: true }),
    User.countDocuments({ 'subscription.plan': { $ne: 'free' }, 'subscription.status': 'active' }),
    Payment.countDocuments(),
    Payment.aggregate([
      { $match: { status: 'succeeded' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  return res.json({
    users: { total: totalUsers, banned: bannedUsers, premium: premiumUsers },
    payments: { total: totalPayments, revenue: succeededRevenue[0]?.total ?? 0 },
  });
});

module.exports = router;
