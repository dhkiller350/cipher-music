'use strict';

const { Router } = require('express');
const User = require('../models/User');
const auth = require('../middleware/auth');
const maintenanceMode = require('../middleware/maintenance');

const router = Router();
router.use(auth);
router.use(maintenanceMode);

// ── GET /user/profile ──────────────────────────────────────────────────────────
router.get('/profile', async (req, res) => {
  const user = await User.findById(req.user.sub).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ user });
});

// ── PATCH /user/profile ────────────────────────────────────────────────────────
router.patch('/profile', async (req, res) => {
  const allowed = ['username'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const user = await User.findByIdAndUpdate(
    req.user.sub,
    { $set: updates },
    { new: true, runValidators: true }
  ).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ user });
});

// ── GET /user/settings ─────────────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  const user = await User.findById(req.user.sub).select('settings').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ settings: user.settings });
});

// ── PATCH /user/settings ───────────────────────────────────────────────────────
router.patch('/settings', async (req, res) => {
  const allowed = ['theme', 'audioQuality', 'notifications', 'autoplay', 'crossfade'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[`settings.${key}`] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid settings fields provided' });
  }

  const user = await User.findByIdAndUpdate(
    req.user.sub,
    { $set: updates },
    { new: true, runValidators: true }
  ).select('settings').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ settings: user.settings });
});

// ── GET /user/recent ───────────────────────────────────────────────────────────
router.get('/recent', async (req, res) => {
  const user = await User.findById(req.user.sub).select('recentPlayed').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ recentPlayed: user.recentPlayed });
});

// ── POST /user/recent ──────────────────────────────────────────────────────────
router.post('/recent', async (req, res) => {
  const { trackId, title, artist, thumbnail } = req.body;
  if (!trackId) {
    return res.status(400).json({ error: 'trackId is required' });
  }

  const user = await User.findById(req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.addRecentPlayed({ trackId, title, artist, thumbnail });
  user.syncVersion += 1;
  user.lastSyncedAt = new Date();
  await user.save();

  return res.json({ recentPlayed: user.recentPlayed });
});

// ── DELETE /user/recent ────────────────────────────────────────────────────────
router.delete('/recent', async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.user.sub,
    { $set: { recentPlayed: [], lastSyncedAt: new Date() }, $inc: { syncVersion: 1 } },
    { new: true }
  ).select('recentPlayed syncVersion').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ message: 'History cleared', recentPlayed: user.recentPlayed });
});

// ── GET /user/sessions ─────────────────────────────────────────────────────────
router.get('/sessions', async (req, res) => {
  const user = await User.findById(req.user.sub).select('sessions').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Don't expose refresh token hashes to the client
  const sessions = (user.sessions || []).map(({ sessionId, deviceName, userAgent, ip, lastSeen, expiresAt }) => ({
    sessionId,
    deviceName,
    userAgent,
    ip,
    lastSeen,
    expiresAt,
    current: sessionId === req.user.sessionId,
  }));
  return res.json({ sessions });
});

// ── DELETE /user/sessions/:sessionId ──────────────────────────────────────────
router.delete('/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const user = await User.findById(req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const before = user.sessions.length;
  user.sessions = user.sessions.filter((s) => s.sessionId !== sessionId);
  if (user.sessions.length === before) {
    return res.status(404).json({ error: 'Session not found' });
  }
  await user.save();
  return res.json({ message: 'Session revoked' });
});

module.exports = router;
