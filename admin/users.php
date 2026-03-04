<?php
/**
 * Cipher Music — User Sync Endpoint
 *
 * POST /admin/users.php
 *   Body: { username, email, memberSince }
 *   → Appends user registration to users.json (no password hashes stored)
 *
 * GET  /admin/users.php?token=<ADMIN_PIN_HASH>
 *   → Returns full user list (admin only)
 *
 * Users are identified by email address; duplicate emails are silently ignored.
 */

require_once __DIR__ . '/cors.php';
cipher_cors('GET, POST, DELETE, OPTIONS');

$ADMIN_PIN_HASH = getenv('CIPHER_ADMIN_PIN_HASH')
    ?: 'c1f330d0aff31c1c87403f1e4347bcc21aff7c179908723535f2b31723702525'; // hash of '5555'

$USERS_FILE = __DIR__ . '/data/users.json';

function load_users(string $file): array {
    if (!file_exists($file)) return [];
    return json_decode(file_get_contents($file) ?: '[]', true) ?: [];
}

function save_users(string $file, array $users): void {
    $dir = dirname($file);
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    file_put_contents($file, json_encode(array_values($users), JSON_PRETTY_PRINT));
}

// ── GET — admin fetch all users ───────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $token = trim($_GET['token'] ?? $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '');
    if ($token !== $ADMIN_PIN_HASH) {
        http_response_code(403); echo json_encode(['ok' => false, 'error' => 'Unauthorized']); exit;
    }
    echo json_encode(['ok' => true, 'users' => load_users($USERS_FILE)]);
    exit;
}

// ── POST — register user (public, no auth) ────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw  = file_get_contents('php://input');
    $data = json_decode($raw ?: '{}', true) ?: [];

    $email    = filter_var(trim($data['email']       ?? ''), FILTER_SANITIZE_EMAIL);
    $username = htmlspecialchars(substr(trim($data['username']    ?? ''), 0, 50), ENT_QUOTES, 'UTF-8');
    $since    = htmlspecialchars(substr(trim($data['memberSince'] ?? ''), 0, 40), ENT_QUOTES, 'UTF-8');

    if (!$email || !$username) {
        http_response_code(400); echo json_encode(['ok' => false, 'error' => 'email and username required']); exit;
    }

    $users = load_users($USERS_FILE);

    // Duplicate check
    foreach ($users as $u) {
        if (strtolower($u['email'] ?? '') === strtolower($email)) {
            echo json_encode(['ok' => true, 'note' => 'already registered']); exit;
        }
    }

    $users[] = ['username' => $username, 'email' => $email, 'memberSince' => $since, 'registeredAt' => date('c')];
    save_users($USERS_FILE, $users);
    echo json_encode(['ok' => true]);
    exit;
}

// ── DELETE — admin remove user ────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $token = trim($_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '');
    if ($token !== $ADMIN_PIN_HASH) {
        http_response_code(403); echo json_encode(['ok' => false, 'error' => 'Unauthorized']); exit;
    }
    $raw  = file_get_contents('php://input');
    $data = json_decode($raw ?: '{}', true) ?: [];
    $email = strtolower(trim($data['email'] ?? ''));
    $users = array_values(array_filter(load_users($USERS_FILE), fn($u) => strtolower($u['email'] ?? '') !== $email));
    save_users($USERS_FILE, $users);

    // Also add to banned list so the front-end can sync
    $bannedFile = __DIR__ . '/data/banned.json';
    $banned = file_exists($bannedFile) ? (json_decode(file_get_contents($bannedFile) ?: '[]', true) ?: []) : [];
    if ($email && !in_array($email, $banned, true)) {
        $banned[] = $email;
        $dir = dirname($bannedFile);
        if (!is_dir($dir)) mkdir($dir, 0700, true);
        file_put_contents($bannedFile, json_encode($banned, JSON_PRETTY_PRINT));
    }

    echo json_encode(['ok' => true]);
    exit;
}

http_response_code(405);
echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
