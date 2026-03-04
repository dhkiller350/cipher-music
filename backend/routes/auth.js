'use strict';

const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');

const router = Router();

const JWT_SECRET = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return secret;
};

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 1 minute.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this IP. Try again later.' },
});

// ── POST /register ─────────────────────────────────────────────────────────────
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

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ username, email, passwordHash });

  return res.status(201).json({
    message: 'Account created',
    user: { id: user._id, username: user.username, email: user.email, subscription: user.subscription },
  });
});

// ── POST /login ────────────────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.banned) {
    return res.status(403).json({ error: 'Account is banned' });
  }

  const token = jwt.sign(
    { sub: user._id.toString(), email: user.email, role: user.role, subscription: user.subscription },
    JWT_SECRET(),
    { algorithm: 'HS256', expiresIn: '7d' }
  );

  return res.json({
    token,
    user: { id: user._id, username: user.username, email: user.email, subscription: user.subscription },
  });
});

module.exports = router;
