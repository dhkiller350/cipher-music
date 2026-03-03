<?php
/**
 * Cipher Music — Admin Payment Dashboard
 *
 * PIN-protected PHP admin panel for the owner/creator.
 * Receives pending payment notifications from the app via
 * POST /admin/notify.php, then lets the admin:
 *   - View all pending payments
 *   - Generate the activation code for any payment
 *   - Mark payments as confirmed
 *
 * Access: /admin/index.php
 * Default PIN: change ADMIN_PIN_HASH below (SHA-256 of your PIN)
 *
 * To generate the hash for a new PIN run in a terminal:
 *   echo -n "your_pin_here" | sha256sum
 */

// ── Configuration ─────────────────────────────────────────────────────────────
// SHA-256 hash of the admin PIN.
// Set via CIPHER_ADMIN_PIN_HASH environment variable on your server (recommended).
// If the env var is not set, the placeholder below is the hash of '0000' — 
// CHANGE IT immediately after first login.
//   Generate hash: echo -n "yourpin" | sha256sum
$ADMIN_PIN_HASH = getenv('CIPHER_ADMIN_PIN_HASH')
    ?: '9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0'; // hash of '0000'

// File where pending payments are stored (JSON array)
$PAYMENTS_FILE = __DIR__ . '/data/payments.json';

// Salt appended when computing activation codes (must match app.js CM2026_CIPHER)
const ACTIVATION_SALT = 'CM2026_CIPHER';

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

    // Confirm a payment (mark as confirmed + store activation code)
    if (!empty($_POST['action']) && $_POST['action'] === 'confirm') {
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
    if (!empty($_POST['action']) && $_POST['action'] === 'delete') {
        $ref = trim($_POST['ref'] ?? '');
        $payments = array_values(array_filter($payments, fn($p) => $p['ref'] !== $ref));
        save_payments($PAYMENTS_FILE, $payments);
        $message = "Payment {$ref} removed.";
    }

    // Revoke a payment
    if (!empty($_POST['action']) && $_POST['action'] === 'revoke') {
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
}

$payments = $authed ? load_payments($PAYMENTS_FILE) : [];
$pending   = array_filter($payments, fn($p) => ($p['status'] ?? 'pending') === 'pending');
$confirmed = array_filter($payments, fn($p) => ($p['status'] ?? '') === 'confirmed');
$revoked   = array_filter($payments, fn($p) => ($p['status'] ?? '') === 'revoked');

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
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }

    /* ── Login ─────────────────────────────────── */
    .login-wrap { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
    .login-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 40px 32px; max-width: 360px; width: 100%; }
    .login-card h1 { font-size: 1.4rem; margin-bottom: 8px; color: var(--accent); }
    .login-card p  { font-size: 0.85rem; color: var(--text2); margin-bottom: 24px; }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; font-size: 0.8rem; color: var(--text2); margin-bottom: 6px; }
    .form-group input { width: 100%; padding: 10px 14px; background: rgba(255,255,255,0.06); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 1rem; }
    .form-group input:focus { outline: none; border-color: var(--accent); }
    .btn { display: block; width: 100%; padding: 12px; border: none; border-radius: 8px; font-size: 0.95rem; font-weight: 600; cursor: pointer; }
    .btn-accent { background: linear-gradient(135deg,var(--purple),var(--accent)); color: #fff; }
    .btn-danger { background: var(--danger); color: #fff; padding: 6px 12px; width: auto; font-size: 0.8rem; border-radius: 4px; }
    .btn-success { background: var(--success); color: #fff; padding: 6px 12px; width: auto; font-size: 0.8rem; border-radius: 4px; }
    .btn-warn   { background: #ff6b00; color: #fff; padding: 6px 12px; width: auto; font-size: 0.8rem; border-radius: 4px; }
    .badge-revoked { background: rgba(255,68,68,0.18); color: #ff6b6b; }
    .error { color: var(--danger); font-size: 0.85rem; margin-top: 8px; }

    /* ── Dashboard layout ──────────────────────── */
    .dash-header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; }
    .dash-header h1 { font-size: 1.1rem; color: var(--accent); }
    .dash-header a { color: var(--text2); font-size: 0.82rem; text-decoration: none; }
    .dash-header a:hover { color: var(--text); }
    .dash-content { max-width: 900px; margin: 32px auto; padding: 0 20px; }

    /* Stats bar */
    .stats-bar { display: flex; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }
    .stat-card { flex: 1; min-width: 140px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 20px; }
    .stat-card .stat-n { font-size: 2rem; font-weight: 700; color: var(--accent); }
    .stat-card .stat-l { font-size: 0.78rem; color: var(--text2); margin-top: 4px; }

    /* Message / flash */
    .flash { padding: 12px 16px; border-radius: 6px; margin-bottom: 20px; font-size: 0.88rem; }
    .flash.ok  { background: rgba(0,200,83,0.12); border: 1px solid rgba(0,200,83,0.3); color: #69f0ae; }
    .flash.err { background: rgba(255,68,68,0.12); border: 1px solid rgba(255,68,68,0.3); color: #ff8a8a; }

    /* Section headings */
    .section-head { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); font-weight: 600; margin-bottom: 12px; }

    /* Payment table */
    .payment-table { width: 100%; border-collapse: collapse; margin-bottom: 36px; }
    .payment-table th { font-size: 0.75rem; text-transform: uppercase; color: var(--text2); padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); }
    .payment-table td { padding: 12px 10px; font-size: 0.85rem; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: middle; }
    .payment-table tr:last-child td { border-bottom: none; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 600; }
    .badge-pending  { background: rgba(255,171,0,0.18); color: var(--warn); }
    .badge-confirmed{ background: rgba(0,200,83,0.18); color: var(--success); }
    .badge-pro      { background: rgba(0,212,255,0.15); color: var(--accent); }
    .badge-premium  { background: rgba(124,58,237,0.18); color: #b48bff; }
    .code-chip { font-family: monospace; background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 4px; font-size: 0.82rem; letter-spacing: 0.04em; }
    .empty-msg { color: var(--text2); font-size: 0.88rem; padding: 20px 0; text-align: center; }
    .action-btns { display: flex; gap: 8px; flex-wrap: wrap; }

    @media (max-width: 640px) {
      .payment-table thead { display: none; }
      .payment-table td { display: block; padding: 6px 10px; }
      .payment-table td::before { content: attr(data-label) ': '; color: var(--text2); font-size: 0.72rem; }
      .payment-table tr { border-bottom: 1px solid var(--border); margin-bottom: 8px; display: block; }
    }
  </style>
</head>
<body>

<?php if (!$authed): ?>
<!-- ── Login page ── -->
<div class="login-wrap">
  <div class="login-card">
    <h1>🔐 Cipher Admin</h1>
    <p>Enter your admin PIN to access the payment dashboard.</p>
    <?php if ($locked): ?>
      <p class="error">Too many failed attempts. Try again in 10 minutes.</p>
    <?php else: ?>
    <form method="post">
      <div class="form-group">
        <label for="pin">Admin PIN</label>
        <input type="password" id="pin" name="pin"
               placeholder="Enter your PIN" autofocus autocomplete="current-password" />
      </div>
      <button type="submit" class="btn btn-accent">Unlock Dashboard</button>
    <?php endif; ?>
  </div>
</div>

<?php else: ?>
<!-- ── Dashboard ── -->
<div class="dash-header">
  <h1>🛠 Cipher Admin — Payments</h1>
  <a href="?logout=1">Logout</a>
</div>

<div class="dash-content">

  <?php if ($message): ?>
    <div class="flash ok"><?= h($message) ?></div>
  <?php endif; ?>

  <!-- Stats -->
  <div class="stats-bar">
    <div class="stat-card">
      <div class="stat-n"><?= count($pending) ?></div>
      <div class="stat-l">Pending payments</div>
    </div>
    <div class="stat-card">
      <div class="stat-n"><?= count($confirmed) ?></div>
      <div class="stat-l">Confirmed payments</div>
    </div>
    <div class="stat-card">
      <div class="stat-n"><?= count($payments) ?></div>
      <div class="stat-l">Total payments</div>
    </div>
  </div>

  <!-- Pending payments ─────────────────────────────────────── -->
  <p class="section-head">⏳ Pending — needs your approval</p>
  <?php if (empty($pending)): ?>
    <p class="empty-msg">No pending payments.</p>
  <?php else: ?>
  <table class="payment-table">
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
                  onsubmit="return confirm('Revoke this payment? The activation code will stop working.')">
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
  <table class="payment-table">
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
          <form method="post" style="display:inline"
                onsubmit="return confirm('Delete this confirmed record?')">
            <input type="hidden" name="action" value="delete">
            <input type="hidden" name="ref" value="<?= h($p['ref'] ?? '') ?>">
            <button type="submit" class="btn btn-danger">✕</button>
          </form>
          <form method="post" style="display:inline"
                onsubmit="return confirm('Revoke this payment? Activation code will stop working.')">
            <input type="hidden" name="action" value="revoke">
            <input type="hidden" name="ref" value="<?= h($p['ref'] ?? '') ?>">
            <button type="submit" class="btn btn-warn">🚫</button>
          </form>
        </td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table>
  <?php endif; ?>

  <!-- Revoked payments ──────────────────────────────────── -->
  <?php if (!empty($revoked)): ?>
  <p class="section-head" style="margin-top:32px;color:#ff6b6b">🚫 Revoked</p>
  <table class="payment-table">
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

</div><!-- /dash-content -->

<?php endif; ?>
</body>
</html>
