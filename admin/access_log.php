<?php
/**
 * Cipher Music — Access / Activity Log Endpoint
 *
 * Called by the front-end whenever a user logs in, signs up, or connects.
 * Stores entries in admin/data/access_log.json so the admin can review
 * from the dashboard or the terminal.
 *
 * POST /admin/access_log.php
 *   Body: { event:"login"|"signup"|"access", email, username, ip, ua, ts }
 *   → Appends entry (no auth required — public, best-effort logging)
 *
 * GET  /admin/access_log.php?token=<ADMIN_PIN_HASH>[&limit=100]
 *   → Returns access log (admin only)
 *
 * DELETE /admin/access_log.php
 *   Header: X-Admin-Token: <ADMIN_PIN_HASH>
 *   Body:   {} (clears all) OR { email:"..." } (remove by email)
 */

require_once __DIR__ . '/cors.php';
cipher_cors('GET, POST, DELETE, OPTIONS');

$ADMIN_PIN_HASH = getenv('CIPHER_ADMIN_PIN_HASH')
    ?: '9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0'; // hash of '0000'

$LOG_FILE = __DIR__ . '/data/access_log.json';

const MAX_LOG_ENTRIES    = 2000; // maximum entries stored in access_log.json
const MAX_USERNAME_LEN   = 50;   // truncation limit for usernames
const MAX_UA_LEN         = 300;  // truncation limit for User-Agent strings

function load_log(string $file): array {
    if (!file_exists($file)) return [];
    return json_decode(file_get_contents($file) ?: '[]', true) ?: [];
}

function save_log(string $file, array $entries): void {
    $dir = dirname($file);
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    file_put_contents($file, json_encode(array_values($entries), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

// ── GET — return log (admin only) ────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $token = trim($_GET['token'] ?? $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '');
    if ($token !== $ADMIN_PIN_HASH) {
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'Unauthorized']);
        exit;
    }
    $limit   = max(1, min(1000, (int)($_GET['limit'] ?? 200)));
    $entries = load_log($LOG_FILE);
    // Return newest first
    $entries = array_reverse($entries);
    if (count($entries) > $limit) $entries = array_slice($entries, 0, $limit);
    echo json_encode(['ok' => true, 'entries' => $entries, 'total' => count($entries)]);
    exit;
}

// ── POST — append event (public, no auth) ─────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw  = file_get_contents('php://input');
    $data = json_decode($raw ?: '{}', true) ?: [];

    $allowed_events = ['login', 'signup', 'access', 'logout'];
    $event   = in_array($data['event'] ?? '', $allowed_events, true) ? $data['event'] : 'access';
    $email   = filter_var(trim($data['email']    ?? ''), FILTER_SANITIZE_EMAIL) ?: '—';
    $username = htmlspecialchars(substr(trim($data['username'] ?? ''), 0, MAX_USERNAME_LEN), ENT_QUOTES, 'UTF-8') ?: '—';
    $ua      = htmlspecialchars(substr(trim($data['ua']       ?? ''), 0, MAX_UA_LEN), ENT_QUOTES, 'UTF-8');
    $ts      = intval($data['ts'] ?? (time() * 1000));

    // Resolve client IP server-side (more reliable than what the browser reports)
    $ip = cipher_client_ip();

    $entry = [
        'event'    => $event,
        'email'    => $email,
        'username' => $username,
        'ip'       => $ip,
        'ua'       => $ua,
        'ts'       => $ts,
        'logged_at'=> date('c'),
    ];

    $entries = load_log($LOG_FILE);
    $entries[] = $entry;

    // Keep last MAX_LOG_ENTRIES entries to prevent unbounded growth
    if (count($entries) > MAX_LOG_ENTRIES) {
        $entries = array_slice($entries, -MAX_LOG_ENTRIES);
    }

    save_log($LOG_FILE, $entries);

    // Mirror the event to the terminal (PHP error_log → server stdout/stderr)
    // Partially redact email to avoid unnecessary PII exposure in log files
    $label = strtoupper($entry['event']);
    $parts = explode('@', $entry['email']);
    $masked_email = count($parts) === 2
        ? substr($parts[0], 0, 2) . '***@' . $parts[1]
        : $entry['email'];
    error_log("[Cipher] {$label} | email={$masked_email} user={$entry['username']} ip={$entry['ip']} ts={$entry['logged_at']}");

    echo json_encode(['ok' => true]);
    exit;
}

// ── DELETE — clear log or remove entries by email (admin only) ────────────────
if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $token = trim($_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '');
    if ($token !== $ADMIN_PIN_HASH) {
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'Unauthorized']);
        exit;
    }
    $raw  = file_get_contents('php://input');
    $data = json_decode($raw ?: '{}', true) ?: [];
    $email = strtolower(trim($data['email'] ?? ''));

    if ($email) {
        // Remove entries for a specific email
        $entries = load_log($LOG_FILE);
        $entries = array_values(array_filter($entries, fn($e) => strtolower($e['email'] ?? '') !== $email));
        save_log($LOG_FILE, $entries);
        echo json_encode(['ok' => true, 'message' => "Log entries for {$email} removed."]);
    } else {
        // Clear entire log
        save_log($LOG_FILE, []);
        echo json_encode(['ok' => true, 'message' => 'Access log cleared.']);
    }
    exit;
}

http_response_code(405);
echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
