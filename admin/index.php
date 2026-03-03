<?php
/**
 * Cipher Music — Admin Dashboard
 *
 * PIN-protected PHP admin panel for the owner/creator.
 * Receives pending payment notifications from the app via
 * POST /admin/notify.php, then lets the admin:
 *   - View/confirm/revoke/delete payments
 *   - View/delete users, unban users
 *   - Toggle maintenance mode (also available via CLI: admin/maintenance.php)
 *
 * Access: /admin/index.php
 * Default PIN: change ADMIN_PIN_HASH below (SHA-256 of your PIN)
 *
 * To generate the hash for a new PIN run in a terminal:
 *   echo -n "your_pin_here" | sha256sum
 */

// cors.php provides cipher_client_ip() (no CORS headers emitted here —
// index.php is an HTML page, not a JSON API).
require_once __DIR__ . '/cors.php';

// ── Configuration ─────────────────────────────────────────────────────────────
// SHA-256 hash of the admin PIN.
// Set via CIPHER_ADMIN_PIN_HASH environment variable on your server (recommended).
// If the env var is not set, the placeholder below is the hash of '0000' — 
// CHANGE IT immediately after first login.
//   Generate hash: echo -n "yourpin" | sha256sum
$ADMIN_PIN_HASH = getenv('CIPHER_ADMIN_PIN_HASH')
    ?: '9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0'; // hash of '0000'

// File where pending payments are stored (JSON array)
$PAYMENTS_FILE   = __DIR__ . '/data/payments.json';
$USERS_FILE      = __DIR__ . '/data/users.json';
$BANNED_FILE     = __DIR__ . '/data/banned.json';
$STATUS_FILE     = __DIR__ . '/data/status.json';
$ACCESS_LOG_FILE = __DIR__ . '/data/access_log.json';

// Salt appended when computing activation codes (must match app.js CM2026_CIPHER)
const ACTIVATION_SALT = 'CM2026_CIPHER';
// Maximum access log entries displayed in the dashboard
const LOG_DISPLAY_LIMIT = 200;
// Maximum UA string length shown in the dashboard
const LOG_UA_DISPLAY   = 60;

// ── Helpers ───────────────────────────────────────────────────────────────────
function load_payments(string $file): array {
    if (!file_exists($file)) return [];
    $json = file_get_contents($file);
    return json_decode($json ?: '[]', true) ?: [];
}

function save_payments(string $file, array $payments): void {
    $dir = dirname($file);
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    file_put_contents($file, json_encode($payments, JSON_PRETTY_PRINT));
}

function load_users(string $file): array {
    if (!file_exists($file)) return [];
    return json_decode(file_get_contents($file) ?: '[]', true) ?: [];
}

function save_users(string $file, array $users): void {
    $dir = dirname($file);
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    file_put_contents($file, json_encode(array_values($users), JSON_PRETTY_PRINT));
}

function load_maintenance(string $file): bool {
    if (!file_exists($file)) return false;
    $state = json_decode(file_get_contents($file) ?: '{}', true) ?: [];
    return (bool)($state['maintenance'] ?? false);
}

function save_maintenance(string $file, bool $on): void {
    $dir = dirname($file);
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    $state = [];
    if (file_exists($file)) {
        $state = json_decode(file_get_contents($file) ?: '{}', true) ?: [];
    }
    $state['maintenance'] = $on;
    $state['ts'] = time();
    if (!isset($state['log'])) $state['log'] = [];
    $state['log'][] = ['ts' => date('c'), 'msg' => 'Maintenance ' . ($on ? 'enabled' : 'disabled') . ' via admin panel', 'ok' => true];
    if (count($state['log']) > 500) $state['log'] = array_slice($state['log'], -500);
    file_put_contents($file, json_encode($state, JSON_PRETTY_PRINT));
}

/**
 * Compute a 10-character activation code that matches the JavaScript version.
 *
 * JavaScript reference (app.js):
 *   const input = `${plan}|${email.trim().toLowerCase()}|${ref}|CM2026_CIPHER`;
 *   // … murmurhash2 → 10-char uppercase hex
 */
function generate_activation_code(string $plan, string $email, string $ref): string {
    $input = strtolower(trim($plan)) . '|' . strtolower(trim($email)) . '|' . $ref . '|' . ACTIVATION_SALT;

    // Replicate the JavaScript MurmurHash2-like algorithm used in app.js
    $h1 = 0xDEADBEEF;
    $h2 = 0x41C6CE57;
    for ($i = 0; $i < strlen($input); $i++) {
        $c = ord($input[$i]);
        $h1 = imul($h1 ^ $c, 2654435761);
        $h2 = imul($h2 ^ $c, 1597334677);
    }
    $h1 = imul($h1 ^ (($h1 >> 16) & 0xFFFF), 2246822507) ^ imul($h2 ^ (($h2 >> 13) & 0x7FFFF), 3266489909);
    $h2 = imul($h2 ^ (($h2 >> 16) & 0xFFFF), 2246822507) ^ imul($h1 ^ (($h1 >> 13) & 0x7FFFF), 3266489909);
    $h1 = $h1 & 0xFFFFFFFF;
    $h2 = $h2 & 0xFFFFFFFF;
    $hex = sprintf('%08x%08x', $h2, $h1);
    return strtoupper(substr($hex, 0, 10));
}

/** Unsigned 32-bit integer multiply (mirrors JavaScript's Math.imul). */
function imul(int $a, int $b): int {
    $ah = ($a >> 16) & 0xFFFF;
    $al = $a & 0xFFFF;
    $bh = ($b >> 16) & 0xFFFF;
    $bl = $b & 0xFFFF;
    $result = (($al * $bl) + (((($ah * $bl + $al * $bh) & 0xFFFF) << 16) & 0xFFFFFFFF)) & 0xFFFFFFFF;
    // Return as signed to match JS bitwise behaviour
    return $result > 0x7FFFFFFF ? $result - 0x100000000 : $result;
}

function h(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

// ── Session / auth ────────────────────────────────────────────────────────────
session_start();

$error   = '';
$message = '';
$authed  = !empty($_SESSION['cipher_admin_authed']);

// ── IP-based rate limiting (max 5 failed attempts per 10 minutes) ─────────────
define('MAX_ATTEMPTS', 5);
define('LOCKOUT_SECS', 600); // 10 minutes
$attempts_key = 'login_attempts_' . md5($_SERVER['REMOTE_ADDR'] ?? '');
$last_key     = 'login_last_'     . md5($_SERVER['REMOTE_ADDR'] ?? '');
$attempts = (int) ($_SESSION[$attempts_key] ?? 0);
$last_ts  = (int) ($_SESSION[$last_key]     ?? 0);

// Reset attempt counter after lockout period
if ($last_ts && (time() - $last_ts) > LOCKOUT_SECS) {
    $attempts = 0;
    unset($_SESSION[$attempts_key], $_SESSION[$last_key]);
}

$locked = $attempts >= MAX_ATTEMPTS;

// Handle login
if (!$locked && $_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['pin'])) {
    $pin = trim($_POST['pin'] ?? '');
    if (hash('sha256', $pin) === $ADMIN_PIN_HASH) {
        $_SESSION['cipher_admin_authed'] = true;
        // Reset failed attempts on success
        unset($_SESSION[$attempts_key], $_SESSION[$last_key]);
        $authed  = true;
        $attempts = 0;
    } else {
        $attempts++;
        $_SESSION[$attempts_key] = $attempts;
        $_SESSION[$last_key]     = time();
        $remaining = MAX_ATTEMPTS - $attempts;
        $error = $remaining > 0
            ? "Incorrect PIN. {$remaining} attempt(s) remaining."
            : 'Too many failed attempts. Try again in 10 minutes.';
    }
}

// Handle logout
if (isset($_GET['logout'])) {
    session_destroy();
    header('Location: index.php');
    exit;
}

// ── Admin actions (only when authenticated) ───────────────────────────────────
if ($authed && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $payments = load_payments($PAYMENTS_FILE);
    $action   = trim($_POST['action'] ?? '');

    // ── Payment actions ───────────────────────────────────────────────────────
    // Confirm a payment (mark as confirmed + store activation code)
    if ($action === 'confirm') {
        $ref = trim($_POST['ref'] ?? '');
        foreach ($payments as &$p) {
            if ($p['ref'] === $ref) {
                $p['status']          = 'confirmed';
                $p['activation_code'] = generate_activation_code($p['plan'], $p['email'], $p['ref']);
                $p['confirmed_at']    = date('c');
                $message = "Payment {$ref} confirmed. Activation code: " . $p['activation_code'];
                break;
            }
        }
        unset($p);
        save_payments($PAYMENTS_FILE, $payments);
    }

    // Delete / reject a payment
    if ($action === 'delete') {
        $ref = trim($_POST['ref'] ?? '');
        $payments = array_values(array_filter($payments, fn($p) => $p['ref'] !== $ref));
        save_payments($PAYMENTS_FILE, $payments);
        $message = "Payment {$ref} removed.";
    }

    // Revoke a payment
    if ($action === 'revoke') {
        $ref = trim($_POST['ref'] ?? '');
        foreach ($payments as &$p) {
            if ($p['ref'] === $ref) {
                $p['status']     = 'revoked';
                $p['revoked_at'] = date('c');
                $message = "Payment {$ref} revoked — activation code disabled.";
                break;
            }
        }
        unset($p);
        save_payments($PAYMENTS_FILE, $payments);
    }

    // ── User actions ──────────────────────────────────────────────────────────
    // Delete user and ban
    if ($action === 'delete_user') {
        $email = strtolower(trim($_POST['email'] ?? ''));
        if ($email) {
            $users = load_users($USERS_FILE);
            $users = array_values(array_filter($users, fn($u) => strtolower($u['email'] ?? '') !== $email));
            save_users($USERS_FILE, $users);
            // Add to banned list
            $banned = load_users($BANNED_FILE);
            if (!in_array($email, $banned, true)) {
                $banned[] = $email;
                file_put_contents($BANNED_FILE, json_encode($banned, JSON_PRETTY_PRINT));
            }
            $message = "User {$email} deleted and banned.";
        }
    }

    // Unban user
    if ($action === 'unban_user') {
        $email = strtolower(trim($_POST['email'] ?? ''));
        if ($email) {
            $banned = load_users($BANNED_FILE);
            $banned = array_values(array_filter($banned, fn($e) => strtolower($e) !== $email));
            file_put_contents($BANNED_FILE, json_encode($banned, JSON_PRETTY_PRINT));
            $message = "User {$email} has been unbanned.";
        }
    }

    // ── Maintenance actions ───────────────────────────────────────────────────
    if ($action === 'maintenance_on') {
        save_maintenance($STATUS_FILE, true);
        $message = 'Maintenance mode ENABLED.';
    }
    if ($action === 'maintenance_off') {
        save_maintenance($STATUS_FILE, false);
        $message = 'Maintenance mode DISABLED.';
    }

    // ── Log actions ───────────────────────────────────────────────────────────
    if ($action === 'clear_log') {
        $dir = dirname($ACCESS_LOG_FILE);
        if (!is_dir($dir)) mkdir($dir, 0700, true);
        file_put_contents($ACCESS_LOG_FILE, '[]');
        $message = 'Access log cleared.';
    }
}

$payments  = $authed ? load_payments($PAYMENTS_FILE) : [];
$pending   = array_filter($payments, fn($p) => ($p['status'] ?? 'pending') === 'pending');
$confirmed = array_filter($payments, fn($p) => ($p['status'] ?? '') === 'confirmed');
$revoked   = array_filter($payments, fn($p) => ($p['status'] ?? '') === 'revoked');

$users         = $authed ? load_users($USERS_FILE)  : [];
$banned        = $authed ? load_users($BANNED_FILE) : [];
$maintenanceOn = $authed ? load_maintenance($STATUS_FILE) : false;

// Access log — newest first, cap at LOG_DISPLAY_LIMIT for the page
$accessLog = [];
if ($authed && file_exists($ACCESS_LOG_FILE)) {
    $accessLog = json_decode(file_get_contents($ACCESS_LOG_FILE) ?: '[]', true) ?: [];
    $accessLog = array_reverse($accessLog);
    if (count($accessLog) > LOG_DISPLAY_LIMIT) $accessLog = array_slice($accessLog, 0, LOG_DISPLAY_LIMIT);
}
$clientIP      = cipher_client_ip();

?><!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cipher Admin — Payment Dashboard</title>
  <style>
    :root {
      --bg: #0e0e1a;
      --surface: #1a1a2e;
      --accent: #00d4ff;
      --purple: #7c3aed;
      --text: #e0e0e0;
      --text2: #888;
      --border: rgba(255,255,255,0.1);
      --success: #00c853;
      --warn: #ffab00;
      --danger: #ff4444;
      --radius: 10px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
           background: var(--bg); color: var(--text); min-height: 100vh; }

    /* ── Login ─────────────────────────────────── */
    .login-wrap { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
    .login-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 40px 32px; max-width: 360px; width: 100%; }
    .login-card h1 { font-size: 1.4rem; margin-bottom: 8px; color: var(--accent); }
    .login-card p  { font-size: 0.85rem; color: var(--text2); margin-bottom: 24px; }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; font-size: 0.8rem; color: var(--text2); margin-bottom: 6px; }
    .form-group input { width: 100%; padding: 10px 14px; background: rgba(255,255,255,0.06); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 1rem; }
    .form-group input:focus { outline: none; border-color: var(--accent); }
    .btn { display: inline-block; padding: 12px 20px; border: none; border-radius: 8px; font-size: 0.95rem; font-weight: 600; cursor: pointer; text-align: center; }
    .btn-block { display: block; width: 100%; }
    .btn-accent { background: linear-gradient(135deg,var(--purple),var(--accent)); color: #fff; }
    .btn-danger { background: var(--danger); color: #fff; padding: 6px 12px; font-size: 0.8rem; border-radius: 4px; }
    .btn-success { background: var(--success); color: #fff; padding: 6px 12px; font-size: 0.8rem; border-radius: 4px; }
    .btn-warn   { background: #ff6b00; color: #fff; padding: 6px 12px; font-size: 0.8rem; border-radius: 4px; }
    .btn-maint-on  { background: var(--danger);  color: #fff; padding: 8px 18px; font-size: 0.9rem; border-radius: 6px; }
    .btn-maint-off { background: var(--success); color: #fff; padding: 8px 18px; font-size: 0.9rem; border-radius: 6px; }
    .badge-revoked { background: rgba(255,68,68,0.18); color: #ff6b6b; }
    .error { color: var(--danger); font-size: 0.85rem; margin-top: 8px; }

    /* ── Dashboard layout ──────────────────────── */
    .dash-header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
    .dash-header h1 { font-size: 1.1rem; color: var(--accent); }
    .dash-header .header-right { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .dash-header .ip-badge { font-size: 0.75rem; color: var(--text2); background: rgba(0,212,255,0.1); border: 1px solid rgba(0,212,255,0.2); border-radius: 4px; padding: 3px 8px; font-family: monospace; }
    .dash-header a { color: var(--text2); font-size: 0.82rem; text-decoration: none; }
    .dash-header a:hover { color: var(--text); }
    .dash-content { max-width: 960px; margin: 24px auto; padding: 0 16px; }

    /* Stats bar */
    .stats-bar { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
    .stat-card { flex: 1; min-width: 120px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; }
    .stat-card .stat-n { font-size: 1.8rem; font-weight: 700; color: var(--accent); }
    .stat-card .stat-l { font-size: 0.75rem; color: var(--text2); margin-top: 4px; }

    /* Message / flash */
    .flash { padding: 12px 16px; border-radius: 6px; margin-bottom: 20px; font-size: 0.88rem; }
    .flash.ok  { background: rgba(0,200,83,0.12); border: 1px solid rgba(0,200,83,0.3); color: #69f0ae; }
    .flash.err { background: rgba(255,68,68,0.12); border: 1px solid rgba(255,68,68,0.3); color: #ff8a8a; }

    /* Tabs */
    .tabs { display: flex; gap: 4px; margin-bottom: 24px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .tab { padding: 10px 18px; font-size: 0.88rem; font-weight: 600; color: var(--text2); cursor: pointer; border-bottom: 2px solid transparent; background: none; border-top: none; border-left: none; border-right: none; }
    .tab:hover { color: var(--text); }
    .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* Section headings */
    .section-head { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); font-weight: 600; margin-bottom: 12px; }

    /* Payment / User table */
    .data-table { width: 100%; border-collapse: collapse; margin-bottom: 36px; }
    .data-table th { font-size: 0.75rem; text-transform: uppercase; color: var(--text2); padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); }
    .data-table td { padding: 11px 10px; font-size: 0.85rem; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: middle; }
    .data-table tr:last-child td { border-bottom: none; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 600; }
    .badge-pending  { background: rgba(255,171,0,0.18); color: var(--warn); }
    .badge-confirmed{ background: rgba(0,200,83,0.18); color: var(--success); }
    .badge-banned   { background: rgba(255,68,68,0.18); color: #ff8a8a; }
    .badge-pro      { background: rgba(0,212,255,0.15); color: var(--accent); }
    .badge-premium  { background: rgba(124,58,237,0.18); color: #b48bff; }
    .code-chip { font-family: monospace; background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 4px; font-size: 0.82rem; letter-spacing: 0.04em; }
    .empty-msg { color: var(--text2); font-size: 0.88rem; padding: 20px 0; text-align: center; }
    .action-btns { display: flex; gap: 6px; flex-wrap: wrap; }

    /* Maintenance card */
    .maint-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; margin-bottom: 24px; }
    .maint-status { font-size: 1.3rem; font-weight: 700; margin-bottom: 16px; }
    .maint-status.on  { color: var(--danger); }
    .maint-status.off { color: var(--success); }
    .maint-hint { font-size: 0.82rem; color: var(--text2); margin-top: 16px; }
    .maint-hint code { background: rgba(255,255,255,0.07); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 0.8rem; }

    /* Responsive — mobile / iPad */
    @media (max-width: 640px) {
      .data-table thead { display: none; }
      .data-table td { display: block; padding: 6px 10px; }
      .data-table td::before { content: attr(data-label) ': '; color: var(--text2); font-size: 0.72rem; }
      .data-table tr { border-bottom: 1px solid var(--border); margin-bottom: 8px; display: block; }
      .stats-bar { gap: 8px; }
      .stat-card { min-width: 100px; }
      .dash-header { padding: 12px 16px; }
      .tabs { gap: 2px; }
      .tab { padding: 8px 12px; font-size: 0.82rem; }
    }
  </style>
</head>
<body>

<?php if (!$authed): ?>
<!-- ── Login page ── -->
<div class="login-wrap">
  <div class="login-card">
    <h1>🔐 Cipher Admin</h1>
    <p>Enter your admin PIN to access the dashboard.</p>
    <?php if ($locked): ?>
      <p class="error">Too many failed attempts. Try again in 10 minutes.</p>
    <?php else: ?>
    <form method="post">
      <div class="form-group">
        <label for="pin">Admin PIN</label>
        <input type="password" id="pin" name="pin"
               placeholder="Enter your PIN" autofocus autocomplete="current-password" />
      </div>
      <?php if ($error): ?>
        <p class="error"><?= h($error) ?></p>
      <?php endif; ?>
      <button type="submit" class="btn btn-accent btn-block" style="margin-top:8px">Unlock Dashboard</button>
    </form>
    <?php endif; ?>
  </div>
</div>

<?php else: ?>
<!-- ── Dashboard ── -->
<div class="dash-header">
  <h1>🛠 Cipher Admin</h1>
  <div class="header-right">
    <span class="ip-badge" title="Your client IP (shown for security awareness)">IP: <?= h($clientIP) ?></span>
    <?php if ($maintenanceOn): ?>
      <span style="color:var(--danger);font-size:0.82rem;font-weight:600">🔴 MAINTENANCE ON</span>
    <?php endif; ?>
    <a href="?logout=1">Logout</a>
  </div>
</div>

<div class="dash-content">

  <?php if ($message): ?>
    <div class="flash ok"><?= h($message) ?></div>
  <?php endif; ?>

  <!-- Stats -->
  <div class="stats-bar">
    <div class="stat-card">
      <div class="stat-n"><?= count($pending) ?></div>
      <div class="stat-l">Pending</div>
    </div>
    <div class="stat-card">
      <div class="stat-n"><?= count($confirmed) ?></div>
      <div class="stat-l">Confirmed</div>
    </div>
    <div class="stat-card">
      <div class="stat-n"><?= count($payments) ?></div>
      <div class="stat-l">Total payments</div>
    </div>
    <div class="stat-card">
      <div class="stat-n"><?= count($users) ?></div>
      <div class="stat-l">Users</div>
    </div>
    <div class="stat-card">
      <div class="stat-n"><?= count($banned) ?></div>
      <div class="stat-l">Banned</div>
    </div>
    <div class="stat-card">
      <div class="stat-n"><?= count($accessLog) ?></div>
      <div class="stat-l">Log entries</div>
    </div>
  </div>

  <!-- Tabs -->
  <div class="tabs">
    <button class="tab active" onclick="showTab('payments',this)">💳 Payments</button>
    <button class="tab" onclick="showTab('users',this)">👤 Users</button>
    <button class="tab" onclick="showTab('logs',this)">📋 Logs</button>
    <button class="tab" onclick="showTab('maintenance',this)">🔧 Maintenance</button>
  </div>

  <!-- ════════════════════════ PAYMENTS TAB ════════════════════════ -->
  <div id="tab-payments" class="tab-panel active">

    <!-- Pending payments ─────────────────────────────────────── -->
    <p class="section-head">⏳ Pending — needs your approval</p>
    <?php if (empty($pending)): ?>
      <p class="empty-msg">No pending payments.</p>
    <?php else: ?>
    <table class="data-table">
      <thead>
        <tr>
          <th>Reference</th>
          <th>Customer</th>
          <th>Plan</th>
          <th>Submitted</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
      <?php foreach ($pending as $p): ?>
        <tr>
          <td data-label="Ref"><span class="code-chip"><?= h($p['ref'] ?? '') ?></span></td>
          <td data-label="Customer">
            <?= h($p['name'] ?? '—') ?><br>
            <small style="color:var(--text2)"><?= h($p['email'] ?? '—') ?></small>
          </td>
          <td data-label="Plan">
            <span class="badge badge-<?= h(strtolower($p['plan'] ?? 'pro')) ?>">
              <?= h(ucfirst($p['plan'] ?? 'pro')) ?>
            </span>
          </td>
          <td data-label="Submitted">
            <?= $p['ts'] ? date('M j, Y g:ia', intval($p['ts'] / 1000)) : '—' ?>
          </td>
          <td data-label="Actions">
            <div class="action-btns">
              <form method="post" style="display:inline">
                <input type="hidden" name="action" value="confirm">
                <input type="hidden" name="ref" value="<?= h($p['ref'] ?? '') ?>">
                <button type="submit" class="btn btn-success">✓ Confirm</button>
              </form>
              <form method="post" style="display:inline"
                    onsubmit="return confirm('Revoke this payment?')">
                <input type="hidden" name="action" value="revoke">
                <input type="hidden" name="ref" value="<?= h($p['ref'] ?? '') ?>">
                <button type="submit" class="btn btn-warn">🚫 Revoke</button>
              </form>
              <form method="post" style="display:inline"
                    onsubmit="return confirm('Remove this payment record?')">
                <input type="hidden" name="action" value="delete">
                <input type="hidden" name="ref" value="<?= h($p['ref'] ?? '') ?>">
                <button type="submit" class="btn btn-danger">✕ Remove</button>
              </form>
            </div>
          </td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    <?php endif; ?>

    <!-- Confirmed payments ──────────────────────────────────── -->
    <p class="section-head" style="margin-top:32px">✅ Confirmed</p>
    <?php if (empty($confirmed)): ?>
      <p class="empty-msg">No confirmed payments yet.</p>
    <?php else: ?>
    <table class="data-table">
      <thead>
        <tr>
          <th>Reference</th>
          <th>Customer</th>
          <th>Plan</th>
          <th>Activation Code</th>
          <th>Confirmed</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
      <?php foreach ($confirmed as $p): ?>
        <tr>
          <td data-label="Ref"><span class="code-chip"><?= h($p['ref'] ?? '') ?></span></td>
          <td data-label="Customer">
            <?= h($p['name'] ?? '—') ?><br>
            <small style="color:var(--text2)"><?= h($p['email'] ?? '—') ?></small>
          </td>
          <td data-label="Plan">
            <span class="badge badge-<?= h(strtolower($p['plan'] ?? 'pro')) ?>">
              <?= h(ucfirst($p['plan'] ?? 'pro')) ?>
            </span>
          </td>
          <td data-label="Code">
            <span class="code-chip"><?= h($p['activation_code'] ?? '—') ?></span>
          </td>
          <td data-label="Confirmed">
            <?= !empty($p['confirmed_at']) ? date('M j, Y g:ia', strtotime($p['confirmed_at'])) : '—' ?>
          </td>
          <td>
            <div class="action-btns">
              <form method="post" style="display:inline"
                    onsubmit="return confirm('Delete this confirmed record?')">
                <input type="hidden" name="action" value="delete">
                <input type="hidden" name="ref" value="<?= h($p['ref'] ?? '') ?>">
                <button type="submit" class="btn btn-danger">✕</button>
              </form>
              <form method="post" style="display:inline"
                    onsubmit="return confirm('Revoke? Activation code will stop working.')">
                <input type="hidden" name="action" value="revoke">
                <input type="hidden" name="ref" value="<?= h($p['ref'] ?? '') ?>">
                <button type="submit" class="btn btn-warn">🚫</button>
              </form>
            </div>
          </td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    <?php endif; ?>

    <!-- Revoked payments ──────────────────────────────────── -->
    <?php if (!empty($revoked)): ?>
    <p class="section-head" style="margin-top:32px;color:#ff6b6b">🚫 Revoked</p>
    <table class="data-table">
      <thead>
        <tr>
          <th>Reference</th>
          <th>Customer</th>
          <th>Plan</th>
          <th>Revoked</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
      <?php foreach ($revoked as $p): ?>
        <tr style="opacity:0.7">
          <td data-label="Ref"><span class="code-chip"><?= h($p['ref'] ?? '') ?></span></td>
          <td data-label="Customer">
            <?= h($p['name'] ?? '—') ?><br>
            <small style="color:var(--text2)"><?= h($p['email'] ?? '—') ?></small>
          </td>
          <td data-label="Plan">
            <span class="badge badge-<?= h(strtolower($p['plan'] ?? 'pro')) ?>">
              <?= h(ucfirst($p['plan'] ?? 'pro')) ?>
            </span>
          </td>
          <td data-label="Revoked">
            <?= !empty($p['revoked_at']) ? date('M j, Y g:ia', strtotime($p['revoked_at'])) : '—' ?>
          </td>
          <td>
            <form method="post" style="display:inline"
                  onsubmit="return confirm('Delete this revoked record?')">
              <input type="hidden" name="action" value="delete">
              <input type="hidden" name="ref" value="<?= h($p['ref'] ?? '') ?>">
              <button type="submit" class="btn btn-danger">✕</button>
            </form>
          </td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    <?php endif; ?>

  </div><!-- /tab-payments -->

  <!-- ════════════════════════ USERS TAB ════════════════════════ -->
  <div id="tab-users" class="tab-panel">

    <!-- Active users ────────────────────────────────────────── -->
    <p class="section-head">👤 Registered Users</p>
    <?php if (empty($users)): ?>
      <p class="empty-msg">No registered users yet.</p>
    <?php else: ?>
    <table class="data-table">
      <thead>
        <tr>
          <th>Username</th>
          <th>Email</th>
          <th>Member Since</th>
          <th>Registered</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
      <?php foreach ($users as $u): ?>
        <tr>
          <td data-label="Username"><?= h($u['username'] ?? '—') ?></td>
          <td data-label="Email"><small><?= h($u['email'] ?? '—') ?></small></td>
          <td data-label="Since"><?= h($u['memberSince'] ?? '—') ?></td>
          <td data-label="Registered">
            <?= !empty($u['registeredAt']) ? date('M j, Y', strtotime($u['registeredAt'])) : '—' ?>
          </td>
          <td data-label="Actions">
            <form method="post" style="display:inline"
                  onsubmit="return confirm('Delete and ban this user?')">
              <input type="hidden" name="action" value="delete_user">
              <input type="hidden" name="email" value="<?= h($u['email'] ?? '') ?>">
              <button type="submit" class="btn btn-danger">🗑 Delete &amp; Ban</button>
            </form>
          </td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    <?php endif; ?>

    <!-- Banned users ────────────────────────────────────────── -->
    <p class="section-head" style="margin-top:32px;color:#ff8a8a">🚫 Banned Users</p>
    <?php if (empty($banned)): ?>
      <p class="empty-msg">No banned users.</p>
    <?php else: ?>
    <table class="data-table">
      <thead>
        <tr>
          <th>Email</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
      <?php foreach ($banned as $email): ?>
        <tr>
          <td data-label="Email">
            <span class="badge badge-banned">banned</span>
            <small style="margin-left:8px"><?= h($email) ?></small>
          </td>
          <td data-label="Actions">
            <form method="post" style="display:inline"
                  onsubmit="return confirm('Unban <?= h($email) ?>?')">
              <input type="hidden" name="action" value="unban_user">
              <input type="hidden" name="email" value="<?= h($email) ?>">
              <button type="submit" class="btn btn-success">✓ Unban</button>
            </form>
          </td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    <?php endif; ?>

  </div><!-- /tab-users -->

  <!-- ════════════════════════ LOGS TAB ════════════════════════ -->
  <div id="tab-logs" class="tab-panel">

    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
      <p class="section-head" style="margin-bottom:0">📋 Access Log — logins, signups &amp; connections</p>
      <?php if (!empty($accessLog)): ?>
      <form method="post" onsubmit="return confirm('Clear the entire access log?')">
        <input type="hidden" name="action" value="clear_log">
        <button type="submit" class="btn btn-danger" style="font-size:0.78rem;padding:5px 10px">🗑 Clear Log</button>
      </form>
      <?php endif; ?>
    </div>

    <?php if (empty($accessLog)): ?>
      <p class="empty-msg">No access log entries yet.<br>
        <small>Log entries appear when users log in or sign up and the app is configured with a server URL.</small>
      </p>
    <?php else: ?>
    <table class="data-table">
      <thead>
        <tr>
          <th>Event</th>
          <th>User</th>
          <th>IP Address</th>
          <th>Browser / Device</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
      <?php foreach ($accessLog as $entry): ?>
        <?php
          $ev = $entry['event'] ?? 'access';
          $evColor = match($ev) {
              'login'  => 'var(--accent)',
              'signup' => 'var(--success)',
              'logout' => 'var(--text2)',
              default  => 'var(--warn)',
          };
          $evIcon = match($ev) {
              'login'  => '🔑',
              'signup' => '✨',
              'logout' => '👋',
              default  => '👁',
          };
          // Simple UA shortening for readability
          $ua = $entry['ua'] ?? '';
          $uaShort = preg_replace('/\s*\([^)]+\)/u', '', $ua);
          $uaShort = strlen($uaShort) > LOG_UA_DISPLAY ? substr($uaShort, 0, LOG_UA_DISPLAY) . '…' : $uaShort;
        ?>
        <tr>
          <td data-label="Event">
            <span style="color:<?= $evColor ?>;font-weight:600"><?= $evIcon ?> <?= h($ev) ?></span>
          </td>
          <td data-label="User">
            <?php if (!empty($entry['username']) && $entry['username'] !== '—'): ?>
              <?= h($entry['username']) ?><br>
            <?php endif; ?>
            <small style="color:var(--text2)"><?= h($entry['email'] ?? '—') ?></small>
          </td>
          <td data-label="IP"><span class="code-chip" style="font-size:0.77rem"><?= h($entry['ip'] ?? '—') ?></span></td>
          <td data-label="Browser" title="<?= h($ua) ?>"><small style="color:var(--text2)"><?= h($uaShort ?: '—') ?></small></td>
          <td data-label="Time" style="white-space:nowrap">
            <small><?= !empty($entry['logged_at']) ? date('M j, Y g:ia', strtotime($entry['logged_at'])) : '—' ?></small>
          </td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    <?php endif; ?>

  </div><!-- /tab-logs -->

  <!-- ════════════════════════ MAINTENANCE TAB ════════════════════════ -->
  <div id="tab-maintenance" class="tab-panel">
    <div class="maint-card">
      <p class="maint-status <?= $maintenanceOn ? 'on' : 'off' ?>">
        <?= $maintenanceOn ? '🔴 Maintenance mode is ON' : '🟢 Maintenance mode is OFF' ?>
      </p>
      <p style="font-size:0.88rem;color:var(--text2);margin-bottom:20px">
        When ON, all app/web visitors see a maintenance page.<br>
        The admin panel remains accessible so you can toggle it back off.
      </p>
      <?php if ($maintenanceOn): ?>
        <form method="post" onsubmit="return confirm('Turn OFF maintenance mode?')">
          <input type="hidden" name="action" value="maintenance_off">
          <button type="submit" class="btn btn-maint-off">🟢 Turn OFF Maintenance</button>
        </form>
      <?php else: ?>
        <form method="post" onsubmit="return confirm('Enable maintenance mode? Users will see a maintenance page.')">
          <input type="hidden" name="action" value="maintenance_on">
          <button type="submit" class="btn btn-maint-on">🔴 Enable Maintenance Mode</button>
        </form>
      <?php endif; ?>

      <div class="maint-hint">
        <p style="margin-top:16px;margin-bottom:8px"><strong>Terminal commands (Ubuntu):</strong></p>
        <p>Enable: <code>php admin/maintenance.php on</code></p>
        <p style="margin-top:6px">Disable: <code>php admin/maintenance.php off</code></p>
        <p style="margin-top:6px">Status: <code>php admin/maintenance.php status</code></p>
        <p style="margin-top:12px">With nginx flag file:</p>
        <p style="margin-top:6px"><code>php admin/maintenance.php on --nginx</code></p>
        <p style="margin-top:6px"><code>php admin/maintenance.php off --nginx</code></p>
        <p style="margin-top:12px">Or directly via nginx flag file:</p>
        <p style="margin-top:6px">Enable: <code>sudo touch /var/www/cipher-music/.maintenance</code></p>
        <p style="margin-top:6px">Disable: <code>sudo rm -f /var/www/cipher-music/.maintenance</code></p>
      </div>
    </div>
  </div><!-- /tab-maintenance -->

</div><!-- /dash-content -->

<script>
function showTab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
}
</script>

<?php endif; ?>
</body>
</html>
