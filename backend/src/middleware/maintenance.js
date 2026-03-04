'use strict';

const Config = require('../models/Config');

/**
 * Maintenance mode middleware.
 * Blocks non-admin requests with 503 when platform_status === 'maintenance'.
 * Must be used after auth() so req.user is available.
 */
async function maintenanceMode(req, res, next) {
  try {
    // Admins bypass maintenance mode
    if (req.user && req.user.role === 'admin') {
      return next();
    }

    const inMaintenance = await Config.isMaintenanceMode();
    if (inMaintenance) {
      return res.status(503).json({
        error: 'Platform is under maintenance. Please try again later.',
        maintenance: true,
      });
    }

    next();
  } catch (err) {
    // If we cannot check maintenance status, allow the request through
    // so a DB hiccup doesn't lock everyone out
    console.error('[maintenance] status check failed:', err.message);
    next();
  }
}

module.exports = maintenanceMode;
