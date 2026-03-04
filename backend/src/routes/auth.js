'use strict';

const { Router } = require('express');
const { randomUUID } = require('crypto');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { signAccessToken, signRefreshToken, verifyRefreshToken, hashToken, compareTokenHash } = require('../utils/jwt');
const auth = require('../middleware/auth');

const router = Router();

// ── Rate limiters ──────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 1 minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many accounts created from this IP. Try again in 1 hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Cookie options ─────────────────────────────────────────────────────────────
function cookieOpts(req) {
  const isProduction = process.env.NODE_ENV === 'production';
  const isCrossOrigin = !!req.headers.origin;
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isCrossOrigin && isProduction ? 'none' : 'lax',
    path: '/',
  };
}

// ── POST /auth/register ────────────────────────────────────────────────────────
router.post('/register', registerLimiter, async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] }).lean();
  if (existing) {
    const field = existing.email === email.toLowerCase() ? 'email' : 'username';
    return res.status(409).json({ error: `${field} is already taken` });
  }

  const user = new User({ username, email });
  await user.setPassword(password);
  await user.save();

  return res.status(201).json({
    message: 'Account created',
    user: { id: user._id, username: user.username, email: user.email, plan: user.subscription.plan },
  });
});

// ── POST /auth/login ───────────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await user.verifyPassword(password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.banned) {
    return res.status(403).json({ error: 'Account is banned', reason: user.banReason });
  }

  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Sign the refresh JWT first, then store its hash for revocation
  const refreshToken = signRefreshToken({ sub: user._id.toString(), sessionId });
  const refreshTokenHash = hashToken(refreshToken);

  // Prune expired sessions
  user.sessions = user.sessions.filter((s) => new Date(s.expiresAt) > new Date());
  // Cap at 5 active sessions per user
  if (user.sessions.length >= 5) {
    user.sessions.sort((a, b) => new Date(a.lastSeen) - new Date(b.lastSeen));
    user.sessions = user.sessions.slice(user.sessions.length - 4);
  }

  user.sessions.push({
    sessionId,
    userAgent: req.headers['user-agent'] || null,
    ip: req.ip,
    refreshTokenHash,
    lastSeen: new Date(),
    expiresAt,
  });
  await user.save();

  const accessToken = signAccessToken({
    sub: user._id.toString(),
    email: user.email,
    plan: user.subscription.plan,
    role: user.role,
    banned: user.banned,
    sessionId,
  });

  const opts = cookieOpts(req);
  res
    .cookie('refresh_token', refreshToken, { ...opts, maxAge: 30 * 24 * 60 * 60 * 1000 })
    .cookie('access_token', accessToken, { ...opts, maxAge: 15 * 60 * 1000 })
    .json({
      accessToken,
      user: { id: user._id, email: user.email, username: user.username, plan: user.subscription.plan },
    });
});

// ── POST /auth/refresh ─────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const rawToken = req.cookies?.refresh_token || req.body?.refreshToken;
  if (!rawToken) {
    return res.status(401).json({ error: 'Refresh token required' });
  }

  let payload;
  try {
    payload = verifyRefreshToken(rawToken);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  const user = await User.findById(payload.sub).select('+passwordHash');
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  const session = user.sessions.find(
    (s) => s.sessionId === payload.sessionId && compareTokenHash(rawToken, s.refreshTokenHash)
  );
  if (!session || new Date(session.expiresAt) < new Date()) {
    return res.status(401).json({ error: 'Session expired or invalid' });
  }

  if (user.banned) {
    return res.status(403).json({ error: 'Account is banned', reason: user.banReason });
  }

  // Rotate refresh token — sign new JWT, store its hash
  const newRefreshToken = signRefreshToken({ sub: user._id.toString(), sessionId: payload.sessionId });
  const newRefreshTokenHash = hashToken(newRefreshToken);
  session.refreshTokenHash = newRefreshTokenHash;
  session.lastSeen = new Date();
  session.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await user.save();

  const newAccessToken = signAccessToken({
    sub: user._id.toString(),
    email: user.email,
    plan: user.subscription.plan,
    role: user.role,
    banned: user.banned,
    sessionId: payload.sessionId,
  });

  const opts = cookieOpts(req);
  res
    .cookie('refresh_token', newRefreshToken, { ...opts, maxAge: 30 * 24 * 60 * 60 * 1000 })
    .cookie('access_token', newAccessToken, { ...opts, maxAge: 15 * 60 * 1000 })
    .json({ accessToken: newAccessToken });
});

// ── POST /auth/logout ──────────────────────────────────────────────────────────
router.post('/logout', auth, async (req, res) => {
  const user = await User.findById(req.user.sub);
  if (user) {
    user.sessions = user.sessions.filter((s) => s.sessionId !== req.user.sessionId);
    await user.save();
  }
  const opts = cookieOpts(req);
  res
    .clearCookie('access_token', { path: opts.path, sameSite: opts.sameSite, secure: opts.secure })
    .clearCookie('refresh_token', { path: opts.path, sameSite: opts.sameSite, secure: opts.secure })
    .json({ message: 'Logged out' });
});

// ── GET /auth/me ───────────────────────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  const user = await User.findById(req.user.sub).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ user });
});

module.exports = router;
