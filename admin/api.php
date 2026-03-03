<?php
/**
 * Cipher Music — Remote Admin REST API
 *
 * Allows the admin to list, delete, and revoke users and payments
 * from any device / browser — including locally via 127.0.0.1.
 *
 * AUTHENTICATION: Every request must carry the admin PIN hash in
 *   the  X-Admin-Token  header (SHA-256 of the PIN, same value
 *   stored in localStorage by the front-end).
 *
 * ENDPOINTS
 * ─────────
 *  GET    /admin/api.php?resource=users             List all users
 *  DELETE /admin/api.php?resource=users&email=x     Delete user by email (also bans)
 *
 *  GET    /admin/api.php?resource=payments          List all payments
 *  POST   /admin/api.php?resource=payments          {action:"confirm"|"revoke", ref:"..."}
 *  DELETE /admin/api.php?resource=payments&ref=x    Delete payment record by ref
 *
 *  GET    /admin/api.php?resource=banned            List banned emails
 *  PATCH  /admin/api.php?resource=banned            {email:"..."} — unban a user
 *
 *  GET    /admin/api.php?resource=status            Health check (auth required)
 *
 * Run a local dev server:
 *   php -S 127.0.0.1:8080 -t /path/to/cipher-music-test
 * Then in the admin panel set Remote Server URL to:
 *   http://127.0.0.1:8080/admin
 */

require_once __DIR__ . '/cors.php';
cipher_cors('GET, POST, DELETE, PATCH, OPTIONS');

// ── Config ────────────────────────────────────────────────────────────────────
$ADMIN_PIN_HASH = getenv('CIPHER_ADMIN_PIN_HASH')
    ?: '9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0'; // hash of '0000'

$PAYMENTS_FILE = __DIR__ . '/data/payments.json';
$USERS_FILE    = __DIR__ . '/data/users.json';
$BANNED_FILE   = __DIR__ . '/data/banned.json';

// ── Auth ──────────────────────────────────────────────────────────────────────
$token = trim($_SERVER['HTTP_X_ADMIN_TOKEN'] ?? $_GET['token'] ?? '');
if ($token !== $ADMIN_PIN_HASH) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Unauthorized — invalid admin token']);
    exit;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function read_json(string $file): array {
    if (!file_exists($file)) return [];
    return json_decode(file_get_contents($file) ?: '[]', true) ?: [];
}

function write_json(string $file, array $data): void {
    $dir = dirname($file);
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function respond(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

// ── Route ─────────────────────────────────────────────────────────────────────
$method   = $_SERVER['REQUEST_METHOD'];
$resource = strtolower($_GET['resource'] ?? '');

// Parse JSON body for POST/DELETE
$body = [];
if (in_array($method, ['POST', 'DELETE', 'PATCH'])) {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw ?: '{}', true) ?: [];
}

// ────────────────────────────────────────────────────────── STATUS
if ($resource === 'status') {
    respond([
        'ok'      => true,
        'version' => '1.0',
        'users'   => count(read_json($USERS_FILE)),
        'payments'=> count(read_json($PAYMENTS_FILE)),
        'ts'      => time()
    ]);
}

// ────────────────────────────────────────────────────────── USERS
if ($resource === 'users') {
    if ($method === 'GET') {
        $users = read_json($USERS_FILE);
        respond(['ok' => true, 'users' => array_values($users)]);
    }

    if ($method === 'DELETE') {
        $email = strtolower(trim($_GET['email'] ?? $body['email'] ?? ''));
        if (!$email) respond(['ok' => false, 'error' => 'email required'], 400);

        // Remove from users
        $users = read_json($USERS_FILE);
        $users = array_values(array_filter($users, fn($u) => strtolower($u['email'] ?? '') !== $email));
        write_json($USERS_FILE, $users);

        // Add to banned list
        $banned = read_json($BANNED_FILE);
        if (!in_array($email, $banned, true)) {
            $banned[] = $email;
            write_json($BANNED_FILE, $banned);
        }

        respond(['ok' => true, 'message' => "User {$email} deleted and banned."]);
    }

    respond(['ok' => false, 'error' => 'Method not allowed'], 405);
}

// ────────────────────────────────────────────────────────── PAYMENTS
if ($resource === 'payments') {
    if ($method === 'GET') {
        $payments = read_json($PAYMENTS_FILE);
        respond(['ok' => true, 'payments' => array_values($payments)]);
    }

    if ($method === 'POST') {
        $action = strtolower(trim($body['action'] ?? ''));
        $ref    = trim($body['ref'] ?? '');
        if (!$ref) respond(['ok' => false, 'error' => 'ref required'], 400);

        $payments = read_json($PAYMENTS_FILE);
        $idx = array_search($ref, array_column($payments, 'ref'));
        if ($idx === false) respond(['ok' => false, 'error' => 'Payment not found'], 404);

        if ($action === 'confirm') {
            $payments[$idx]['status']       = 'confirmed';
            $payments[$idx]['confirmed_at'] = date('c');
            write_json($PAYMENTS_FILE, $payments);
            respond(['ok' => true, 'message' => "Payment {$ref} confirmed."]);
        }

        if ($action === 'revoke') {
            $payments[$idx]['status']     = 'revoked';
            $payments[$idx]['revoked_at'] = date('c');
            write_json($PAYMENTS_FILE, $payments);
            respond(['ok' => true, 'message' => "Payment {$ref} revoked."]);
        }

        respond(['ok' => false, 'error' => 'Unknown action — use confirm or revoke'], 400);
    }

    if ($method === 'DELETE') {
        $ref = trim($_GET['ref'] ?? $body['ref'] ?? '');
        if (!$ref) respond(['ok' => false, 'error' => 'ref required'], 400);

        $payments = read_json($PAYMENTS_FILE);
        $payments = array_values(array_filter($payments, fn($p) => ($p['ref'] ?? '') !== $ref));
        write_json($PAYMENTS_FILE, $payments);
        respond(['ok' => true, 'message' => "Payment {$ref} deleted."]);
    }

    respond(['ok' => false, 'error' => 'Method not allowed'], 405);
}

// ────────────────────────────────────────────────────────── BANNED
if ($resource === 'banned') {
    if ($method === 'GET') {
        respond(['ok' => true, 'banned' => read_json($BANNED_FILE)]);
    }

    // PATCH — unban a user (remove from banned list)
    if ($method === 'PATCH') {
        $email = strtolower(trim($_GET['email'] ?? $body['email'] ?? ''));
        if (!$email) respond(['ok' => false, 'error' => 'email required'], 400);

        $banned = read_json($BANNED_FILE);
        $before = count($banned);
        $banned = array_values(array_filter($banned, fn($e) => strtolower($e) !== $email));
        write_json($BANNED_FILE, $banned);

        respond(['ok' => true, 'message' => $before !== count($banned)
            ? "User {$email} has been unbanned."
            : "User {$email} was not in the banned list."]);
    }

    respond(['ok' => false, 'error' => 'Method not allowed'], 405);
}

// Unknown resource
respond(['ok' => false, 'error' => 'Unknown resource. Valid: users, payments, status, banned'], 404);
