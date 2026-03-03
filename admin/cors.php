<?php
/**
 * Cipher Music — Shared CORS helper
 *
 * Include this file at the top of every admin endpoint.
 * It validates the request Origin and emits the correct
 * Access-Control-* headers, then exits with 403 or 204
 * as appropriate.
 *
 * Allowed origins:
 *   - https://dhkiller350.github.io   (production)
 *   - http://localhost[:<port>]        (local dev, any port)
 *   - http://127.0.0.1[:<port>]       (local dev, any port)
 *
 * Note: All write operations additionally require the admin PIN hash
 * via the X-Admin-Token header, so any-port localhost access is safe —
 * a rogue local process would still need the correct PIN hash token.
 *
 * @param string $allowed_methods  Comma-separated HTTP methods (default 'GET, POST, OPTIONS')
 */
function cipher_cors(string $allowed_methods = 'GET, POST, OPTIONS'): void {
    $origin = rtrim($_SERVER['HTTP_ORIGIN'] ?? '', '/');

    if (_cipher_is_allowed_origin($origin)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    } else {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['ok' => false, 'error' => 'Origin not allowed']);
        exit;
    }

    header('Access-Control-Allow-Methods: ' . $allowed_methods);
    header('Access-Control-Allow-Headers: Content-Type, X-Admin-Token');
    header('Access-Control-Max-Age: 86400');

    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }

    header('Content-Type: application/json');
}

function _cipher_is_allowed_origin(string $o): bool {
    if ($o === 'https://dhkiller350.github.io') return true;
    // http://localhost or http://localhost:PORT
    if (preg_match('/^http:\/\/localhost(:\d{1,5})?$/', $o)) return true;
    // http://127.0.0.1 or http://127.0.0.1:PORT
    if (preg_match('/^http:\/\/127\.0\.0\.1(:\d{1,5})?$/', $o)) return true;
    return false;
}
