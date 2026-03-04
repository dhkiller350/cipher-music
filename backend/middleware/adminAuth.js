'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return secret;
};

/**
 * adminAuth middleware
 *
 * Reads the bearer token from Authorization header, verifies it,
 * and ensures the user has role: "admin".
 * Returns 401 for missing/invalid tokens or non-admin roles.
 */
function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: no token provided' });
  }

  const token = authHeader.slice(7);

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET());
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Unauthorized: token expired' });
    }
    return res.status(401).json({ error: 'Unauthorized: invalid token' });
  }

  if (payload.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }

  req.user = payload;
  next();
}

module.exports = adminAuth;
