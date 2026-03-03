<?php
/**
 * Cipher Music — App-Status Endpoint
 *
 * GET  /admin/status.php          → public JSON: { "maintenance": bool, "ts": int }
 * POST /admin/status.php          → set maintenance state (requires X-Admin-Token header)
 *   Body: { "maintenance": true|false, "token": "<ADMIN_TOKEN>" }
 *
 * The admin token is the SHA-256 of the admin PIN, stored in the same
 * environment variable used by index.php.  The JavaScript side sends
 * the hash it has in localStorage (cipher_admin_pin) as the token.
 */

// ── CORS ─────────────────────────────────────────────────────────────────────
$allowed_origins = [
    'https://dhkiller350.github.io',
    'http://localhost',
    'http://127.0.0.1',
];
$origin = rtrim($_SERVER['HTTP_ORIGIN'] ?? '', '/');
if (in_array($origin, $allowed_origins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
} else {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Origin not allowed']);
    exit;
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Admin-Token');
header('Access-Control-Max-Age: 86400');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

header('Content-Type: application/json');

// ── Config ────────────────────────────────────────────────────────────────────
// SHA-256 of the admin PIN (same hash used by admin/index.php and JS side)
$ADMIN_PIN_HASH = getenv('CIPHER_ADMIN_PIN_HASH')
    ?: 'c1f330d0aff31c1c87403f1e4347bcc21aff7c179908723535f2b31723702525'; // hash of '5555'

$STATE_FILE = __DIR__ . '/data/status.json';

function load_status(string $file): array {
    if (!file_exists($file)) return ['maintenance' => false, 'ts' => 0, 'log' => []];
    return json_decode(file_get_contents($file) ?: '{}', true) ?: ['maintenance' => false, 'ts' => 0, 'log' => []];
}

function save_status(string $file, array $state): void {
    $dir = dirname($file);
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    file_put_contents($file, json_encode($state, JSON_PRETTY_PRINT));
}

// ── GET — public status ───────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $state = load_status($STATE_FILE);
    echo json_encode([
        'maintenance' => (bool)($state['maintenance'] ?? false),
        'ts'          => (int)($state['ts'] ?? 0),
    ]);
    exit;
}

// ── POST — set state (admin only) ─────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['ok' => false, 'error' => 'Method not allowed']); exit;
}

$raw  = file_get_contents('php://input');
$data = json_decode($raw ?: '{}', true) ?: [];

// Accept token from body or header
$token = trim($data['token'] ?? $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '');
if ($token !== $ADMIN_PIN_HASH) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Unauthorized']);
    exit;
}

$state = load_status($STATE_FILE);
$state['maintenance'] = (bool)($data['maintenance'] ?? false);
$state['ts'] = time();

// Append maintenance log entries if provided
if (!empty($data['log']) && is_array($data['log'])) {
    if (!isset($state['log'])) $state['log'] = [];
    foreach ($data['log'] as $entry) {
        $state['log'][] = [
            'ts'  => date('c'),
            'msg' => htmlspecialchars(substr((string)($entry['msg'] ?? ''), 0, 500), ENT_QUOTES, 'UTF-8'),
            'ok'  => (bool)($entry['ok'] ?? true),
        ];
    }
    // Keep only last 500 log entries
    if (count($state['log']) > 500) {
        $state['log'] = array_slice($state['log'], -500);
    }
}

save_status($STATE_FILE, $state);
echo json_encode(['ok' => true, 'maintenance' => $state['maintenance']]);
