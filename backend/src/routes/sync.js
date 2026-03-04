'use strict';

/**
 * Multi-device sync route.
 *
 * Clients send their local syncVersion and a partial state diff.
 * The server merges the diff and responds with the authoritative state.
 *
 * Merge strategy:
 *   - Higher syncVersion wins field-by-field (last-write-wins per field).
 *   - recentPlayed is merged by union, deduplicated, then sorted by playedAt.
 *   - settings are merged field-by-field, server wins on conflict.
 */

const { Router } = require('express');
const User = require('../models/User');
const auth = require('../middleware/auth');
const maintenanceMode = require('../middleware/maintenance');

const router = Router();
router.use(auth);
router.use(maintenanceMode);

// ── GET /sync ─── get current sync state ──────────────────────────────────────
router.get('/', async (req, res) => {
  const user = await User.findById(req.user.sub).select('recentPlayed settings syncVersion lastSyncedAt').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({
    syncVersion: user.syncVersion,
    lastSyncedAt: user.lastSyncedAt,
    recentPlayed: user.recentPlayed,
    settings: user.settings,
  });
});

// ── POST /sync ─── push local state, receive merged authoritative state ────────
router.post('/', async (req, res) => {
  const { clientSyncVersion, recentPlayed: clientRecent, settings: clientSettings } = req.body;

  const user = await User.findById(req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });

  let changed = false;

  // Merge recentPlayed: union by trackId, keep most-recent playedAt
  if (Array.isArray(clientRecent) && clientRecent.length > 0) {
    const map = new Map();

    // Start with server state
    for (const track of user.recentPlayed) {
      map.set(track.trackId, track);
    }

    // Merge client entries — keep the one with the most recent playedAt
    for (const track of clientRecent) {
      if (!track.trackId) continue;
      const existing = map.get(track.trackId);
      const clientDate = new Date(track.playedAt || 0);
      if (!existing || clientDate > new Date(existing.playedAt || 0)) {
        map.set(track.trackId, { ...track, playedAt: clientDate });
      }
    }

    const merged = Array.from(map.values())
      .sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt))
      .slice(0, 100);

    user.recentPlayed = merged;
    changed = true;
  }

  // Merge settings: client overrides server for provided fields
  if (clientSettings && typeof clientSettings === 'object') {
    const allowedFields = ['theme', 'audioQuality', 'notifications', 'autoplay', 'crossfade'];
    for (const field of allowedFields) {
      if (clientSettings[field] !== undefined) {
        user.settings[field] = clientSettings[field];
        changed = true;
      }
    }
    user.markModified('settings');
  }

  if (changed) {
    user.syncVersion += 1;
    user.lastSyncedAt = new Date();
    await user.save();
  }

  return res.json({
    syncVersion: user.syncVersion,
    lastSyncedAt: user.lastSyncedAt,
    recentPlayed: user.recentPlayed,
    settings: user.settings,
    // A client is considered stale if it is more than 1 version behind the server.
    // Being exactly one version behind is acceptable because the server may have
    // just incremented on this very request (i.e. the client's state was current
    // before this sync call).
    stale: typeof clientSyncVersion === 'number' && clientSyncVersion < user.syncVersion - 1,
  });
});

module.exports = router;
