<?php
/**
 * Cipher Music — Payment Notification Endpoint
 *
 * Receives a JSON POST from the front-end when a user submits
 * a payment confirmation.  Appends the payment to payments.json
 * so the admin dashboard can review it.
 *
 * Called by app.js → sendAdminPaymentNotification() as a
 * best-effort side-channel (EmailJS is the primary notification).
 *
 * POST /admin/notify.php
 * Body: { plan, email, name, ref, ts }
 */

// ── Allowed origins for CORS ──────────────────────────────────────────────────
$allowed_origins = [
    'https://dhkiller350.github.io',
    'http://localhost',
    'http://127.0.0.1',
];

$origin = rtrim($_SERVER['HTTP_ORIGIN'] ?? '', '/');

// Set CORS headers — only allow the listed origins
if (in_array($origin, $allowed_origins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
} else {
    // No matching origin — block the request
    http_response_code(403);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'Origin not allowed']);
    exit;
}

header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Max-Age: 86400');

// Handle pre-flight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Only accept POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'Method Not Allowed']);
    exit;
}

// Parse JSON body
$raw  = file_get_contents('php://input');
$data = json_decode($raw ?: '{}', true);

if (empty($data['ref']) || empty($data['plan']) || empty($data['email'])) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'Missing required fields']);
    exit;
}

// Sanitise
$payment = [
    'ref'    => preg_replace('/[^A-Z0-9\-]/', '', strtoupper($data['ref'])),
    'plan'   => in_array($data['plan'], ['pro', 'premium'], true) ? $data['plan'] : 'pro',
    'email'  => filter_var($data['email'], FILTER_SANITIZE_EMAIL),
    'name'   => htmlspecialchars(substr($data['name'] ?? '', 0, 100), ENT_QUOTES, 'UTF-8'),
    'ts'     => intval($data['ts'] ?? (time() * 1000)),
    'status' => 'pending',
    'received_at' => date('c'),
];

// Load existing payments
$file = __DIR__ . '/data/payments.json';
$dir  = dirname($file);
if (!is_dir($dir)) mkdir($dir, 0700, true);

$payments = [];
if (file_exists($file)) {
    $payments = json_decode(file_get_contents($file) ?: '[]', true) ?: [];
}

// Prevent duplicate refs
foreach ($payments as $existing) {
    if ($existing['ref'] === $payment['ref']) {
        header('Content-Type: application/json');
        echo json_encode(['ok' => true, 'note' => 'duplicate ref ignored']);
        exit;
    }
}

$payments[] = $payment;

// Save
$ok = (bool) file_put_contents($file, json_encode($payments, JSON_PRETTY_PRINT));

header('Content-Type: application/json');
echo json_encode(['ok' => $ok]);
