<?php
/**
 * Cipher Music Server - Main Configuration
 * Copy this file to config.local.php and update values for production.
 */

// ── Site ──────────────────────────────────────────────────────────────────────
define('SITE_NAME',    'Cipher Music');
define('SITE_URL',     getenv('SITE_URL')     ?: 'http://localhost');
define('APP_VERSION',  '1.0.0');

// ── Paths ─────────────────────────────────────────────────────────────────────
define('BASE_DIR',     dirname(__DIR__));
define('PUBLIC_DIR',   BASE_DIR . '/public');
define('INCLUDE_DIR',  BASE_DIR . '/includes');
define('CONFIG_DIR',   BASE_DIR . '/config');

// ── Session ───────────────────────────────────────────────────────────────────
define('SESSION_NAME',     'cipher_sess');
define('SESSION_LIFETIME', 3600);   // 1 hour
define('ADMIN_SESSION_KEY', 'admin_logged_in');

// ── Maintenance flag file ─────────────────────────────────────────────────────
// This flat-file flag is checked BEFORE the database is available so that
// maintenance mode works even when the DB is down.
// Default: <app-root>/maintenance.flag  — override via environment variable.
define('MAINTENANCE_FLAG_FILE', getenv('MAINTENANCE_FLAG_FILE') ?: BASE_DIR . '/maintenance.flag');

// ── Admin panel path ──────────────────────────────────────────────────────────
// Admin panel is always accessible regardless of maintenance mode.
define('ADMIN_PATH', '/admin');

// ── API ───────────────────────────────────────────────────────────────────────
define('API_PATH',    '/api');

// API_SECRET is required. Generate one with: openssl rand -hex 32
$_apiSecret = getenv('API_SECRET');
if (!$_apiSecret || $_apiSecret === '') {
    http_response_code(503);
    error_log('Cipher Music: API_SECRET environment variable is not set.');
    die(json_encode(['error' => 'Server misconfiguration: API_SECRET is not set.']));
}
define('API_SECRET', $_apiSecret);
unset($_apiSecret);

// ── Security ──────────────────────────────────────────────────────────────────
define('BCRYPT_COST',      12);
define('CSRF_TOKEN_LENGTH', 32);

// ── Timezone ──────────────────────────────────────────────────────────────────
date_default_timezone_set(getenv('TZ') ?: 'UTC');
