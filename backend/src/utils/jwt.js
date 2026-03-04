'use strict';

const jwt = require('jsonwebtoken');
const { createHash, timingSafeEqual } = require('crypto');

const ACCESS_SECRET = () => process.env.JWT_ACCESS_SECRET || 'cipher-music-access-secret-change-in-production';
const REFRESH_SECRET = () => process.env.JWT_REFRESH_SECRET || 'cipher-music-refresh-secret-change-in-production';

const ACCESS_EXPIRES_IN = () => process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN = () => process.env.JWT_REFRESH_EXPIRES_IN || '30d';

/**
 * Signs an access token.
 * @param {{ sub: string, email: string, plan: string, role: string, banned: boolean, sessionId: string }} payload
 */
function signAccessToken(payload) {
  return jwt.sign(payload, ACCESS_SECRET(), {
    algorithm: 'HS256',
    expiresIn: ACCESS_EXPIRES_IN(),
  });
}

/**
 * Signs a refresh token.
 * @param {{ sub: string, sessionId: string }} payload
 */
function signRefreshToken(payload) {
  return jwt.sign(payload, REFRESH_SECRET(), {
    algorithm: 'HS256',
    expiresIn: REFRESH_EXPIRES_IN(),
  });
}

/** Verifies an access token, throws on failure */
function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET());
}

/** Verifies a refresh token, throws on failure */
function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET());
}

/** SHA-256 hash of a token string (for secure DB storage of refresh tokens) */
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison of two hex hashes */
function compareTokenHash(token, storedHash) {
  const computed = hashToken(token);
  try {
    return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, hashToken, compareTokenHash };
