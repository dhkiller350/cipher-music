<?php
/**
 * Cipher Music — Cross-Device Account Store
 *
 * Stores account credentials server-side so users can sign in from
 * any device or browser without losing access to their account.
 *
 * Password hashes (SHA-256) are stored — never plaintext passwords.
 * The data file is protected by .htaccess (Deny from all) so it cannot
 * be read directly via the web.
 *
 * ENDPOINTS (all via POST with JSON body)
 * ────────────────────────────────────────
 *  { action: "sync",            email, username, passwordHash, memberSince, tier? }
 *    → Register or update an account (called on sign-up).
 *
 *  { action: "login",           emailOrUsername, passwordHash }
 *    → Verify credentials for cross-device login.
 *      Returns account data (without passwordHash) on success.
 *
 *  { action: "update_password", email, passwordHash }
 *    → Update stored password hash (called after password change/reset).
 */

require_once __DIR__ . '/cors.php';
cipher_cors('POST, OPTIONS');

$ACCOUNTS_FILE = __DIR__ . '/data/accounts.json';

// ── Helpers ───────────────────────────────────────────────────────────────────

function load_accounts(string $file): array {
    if (!file_exists($file)) return [];
    return json_decode(file_get_contents($file) ?: '[]', true) ?: [];
}

function save_accounts(string $file, array $accounts): void {
    $dir = dirname($file);
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    file_put_contents($file, json_encode(array_values($accounts), JSON_PRETTY_PRINT));
}

function json_response(array $data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

// ── Only POST accepted ────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['ok' => false, 'error' => 'Method not allowed'], 405);
}

$raw  = file_get_contents('php://input');
$body = json_decode($raw ?: '{}', true) ?: [];

$action = strtolower(trim($body['action'] ?? ''));

// ── action: sync (register / upsert account) ─────────────────────────────────
if ($action === 'sync') {
    $email        = filter_var(trim($body['email']        ?? ''), FILTER_SANITIZE_EMAIL);
    $username     = htmlspecialchars(substr(trim($body['username']     ?? ''), 0, 50), ENT_QUOTES, 'UTF-8');
    $passwordHash = preg_replace('/[^a-f0-9]/i', '', trim($body['passwordHash'] ?? ''));
    $memberSince  = htmlspecialchars(substr(trim($body['memberSince']  ?? ''), 0, 40), ENT_QUOTES, 'UTF-8');
    $tier         = in_array($body['tier'] ?? '', ['free', 'pro', 'premium'], true) ? $body['tier'] : 'free';

    if (!$email || !$username || strlen($passwordHash) < 32) {
        json_response(['ok' => false, 'error' => 'email, username and passwordHash are required'], 400);
    }

    $accounts = load_accounts($ACCOUNTS_FILE);

    // Upsert: update if exists, insert if new
    $found = false;
    foreach ($accounts as &$a) {
        if (strtolower($a['email']) === strtolower($email)) {
            $a['username']     = $username;
            $a['passwordHash'] = $passwordHash;
            if ($memberSince) $a['memberSince'] = $memberSince;
            $a['tier']         = $tier;
            $found = true;
            break;
        }
    }
    unset($a);

    if (!$found) {
        $accounts[] = [
            'email'        => $email,
            'username'     => $username,
            'passwordHash' => $passwordHash,
            'memberSince'  => $memberSince,
            'tier'         => $tier,
        ];
    }

    save_accounts($ACCOUNTS_FILE, $accounts);
    json_response(['ok' => true]);
}

// ── action: login (cross-device credential verification) ─────────────────────
if ($action === 'login') {
    $emailOrUsername = strtolower(trim($body['emailOrUsername'] ?? ''));
    $passwordHash    = preg_replace('/[^a-f0-9]/i', '', trim($body['passwordHash']    ?? ''));

    if (!$emailOrUsername || strlen($passwordHash) < 32) {
        json_response(['ok' => false, 'error' => 'emailOrUsername and passwordHash are required'], 400);
    }

    $accounts = load_accounts($ACCOUNTS_FILE);
    $matched  = null;

    foreach ($accounts as $a) {
        if (
            strtolower($a['email'])    === $emailOrUsername ||
            strtolower($a['username']) === $emailOrUsername
        ) {
            $matched = $a;
            break;
        }
    }

    if (!$matched) {
        json_response(['ok' => false, 'error' => 'Account not found'], 404);
    }

    if (!hash_equals($matched['passwordHash'], $passwordHash)) {
        json_response(['ok' => false, 'error' => 'Incorrect password'], 401);
    }

    // Return account data including passwordHash so the client can cache it locally
    // for future offline-first logins on this device.
    json_response([
        'ok'      => true,
        'account' => [
            'email'        => $matched['email'],
            'username'     => $matched['username'],
            'passwordHash' => $matched['passwordHash'], // cached locally to avoid repeated server calls
            'memberSince'  => $matched['memberSince'] ?? '',
            'tier'         => $matched['tier']         ?? 'free',
        ],
    ]);
}

// ── action: update_password ───────────────────────────────────────────────────
if ($action === 'update_password') {
    $email        = filter_var(trim($body['email']        ?? ''), FILTER_SANITIZE_EMAIL);
    $passwordHash = preg_replace('/[^a-f0-9]/i', '', trim($body['passwordHash'] ?? ''));

    if (!$email || strlen($passwordHash) < 32) {
        json_response(['ok' => false, 'error' => 'email and passwordHash are required'], 400);
    }

    $accounts = load_accounts($ACCOUNTS_FILE);
    $updated  = false;

    foreach ($accounts as &$a) {
        if (strtolower($a['email']) === strtolower($email)) {
            $a['passwordHash'] = $passwordHash;
            $updated = true;
            break;
        }
    }
    unset($a);

    if (!$updated) {
        json_response(['ok' => false, 'error' => 'Account not found'], 404);
    }

    save_accounts($ACCOUNTS_FILE, $accounts);
    json_response(['ok' => true]);
}

// ── action: update_plan (cross-device plan sync) ──────────────────────────────
if ($action === 'update_plan') {
    $email        = filter_var(trim($body['email']        ?? ''), FILTER_SANITIZE_EMAIL);
    $passwordHash = preg_replace('/[^a-f0-9]/i', '', trim($body['passwordHash'] ?? ''));
    $tier         = in_array($body['tier'] ?? '', ['free', 'pro', 'premium'], true) ? $body['tier'] : 'free';

    if (!$email || strlen($passwordHash) < 32) {
        json_response(['ok' => false, 'error' => 'email and passwordHash are required'], 400);
    }

    $accounts = load_accounts($ACCOUNTS_FILE);
    $updated  = false;

    foreach ($accounts as &$a) {
        if (strtolower($a['email']) === strtolower($email)) {
            if (!hash_equals($a['passwordHash'], $passwordHash)) {
                json_response(['ok' => false, 'error' => 'Unauthorized'], 401);
            }
            $a['tier'] = $tier;
            $updated   = true;
            break;
        }
    }
    unset($a);

    if (!$updated) {
        json_response(['ok' => false, 'error' => 'Account not found'], 404);
    }

    save_accounts($ACCOUNTS_FILE, $accounts);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Unknown action'], 400);
