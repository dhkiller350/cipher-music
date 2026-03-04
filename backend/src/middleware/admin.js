'use strict';

const auth = require('./auth');

/**
 * Admin middleware — must be used after auth().
 * Rejects requests from non-admin users with 403.
 */
function admin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }
  next();
}

/**
 * Convenience stack: [auth, admin]
 * Usage: router.get('/path', ...requireAdmin, handler)
 */
const requireAdmin = [auth, admin];

module.exports = { admin, requireAdmin };
