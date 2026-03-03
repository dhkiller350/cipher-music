<?php
/**
 * Shared helper functions
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';

// ── IP helpers ────────────────────────────────────────────────────────────────

/**
 * Returns the client IP address, preferring IPv6.
 * Checks common proxy headers then falls back to REMOTE_ADDR.
 */
function getClientIP(): string {
    $candidates = [];

    // Trust X-Forwarded-For only if the server is behind a trusted proxy.
    // In production restrict this to your proxy's IP range.
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        foreach (explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']) as $ip) {
            $ip = trim($ip);
            if (filter_var($ip, FILTER_VALIDATE_IP)) {
                $candidates[] = $ip;
            }
        }
    }

    if (!empty($_SERVER['HTTP_X_REAL_IP'])) {
        $ip = trim($_SERVER['HTTP_X_REAL_IP']);
        if (filter_var($ip, FILTER_VALIDATE_IP)) {
            $candidates[] = $ip;
        }
    }

    $candidates[] = $_SERVER['REMOTE_ADDR'] ?? '::1';

    // Prefer IPv6
    foreach ($candidates as $ip) {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
            return $ip;
        }
    }

    // Fall back to any valid IP (including IPv4-mapped IPv6)
    foreach ($candidates as $ip) {
        if (filter_var($ip, FILTER_VALIDATE_IP)) {
            return normalizeIPv4ToIPv6($ip);
        }
    }

    return '::1';
}

/**
 * Map an IPv4 address to its IPv6-mapped representation (::ffff:x.x.x.x).
 */
function normalizeIPv4ToIPv6(string $ip): string {
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
        return $ip;
    }
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        return '::ffff:' . $ip;
    }
    return $ip;
}

/**
 * Returns 6 for IPv6 addresses, 4 for IPv4.
 */
function ipVersion(string $ip): int {
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
        return 6;
    }
    return 4;
}

/**
 * Format an IPv6 address for display (full expanded form).
 */
function formatIPv6(string $ip): string {
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
        $bin = inet_pton($ip);
        if ($bin !== false) {
            return inet_ntop($bin);
        }
    }
    return $ip;
}

// ── Maintenance mode ──────────────────────────────────────────────────────────

function isMaintenanceMode(): bool {
    // Fast check via flat file first (works even when DB is unavailable)
    if (file_exists(MAINTENANCE_FLAG_FILE)) {
        return true;
    }
    // Fallback: check the database setting
    try {
        $pdo = getDB();
        $stmt = $pdo->prepare("SELECT value FROM settings WHERE name = 'maintenance_mode'");
        $stmt->execute();
        $row = $stmt->fetch();
        return $row && $row['value'] === '1';
    } catch (Exception $e) {
        return false;
    }
}

function setMaintenanceMode(bool $enabled): void {
    // Update flat file
    if ($enabled) {
        file_put_contents(MAINTENANCE_FLAG_FILE, date('Y-m-d H:i:s T'));
    } else {
        if (file_exists(MAINTENANCE_FLAG_FILE)) {
            unlink(MAINTENANCE_FLAG_FILE);
        }
    }
    // Update database
    try {
        $pdo = getDB();
        $stmt = $pdo->prepare("INSERT INTO settings (name, value) VALUES ('maintenance_mode', :val)
                               ON DUPLICATE KEY UPDATE value = :val");
        $stmt->execute([':val' => $enabled ? '1' : '0']);
    } catch (Exception $e) {
        // DB update is best-effort; flat file is authoritative
    }
}

// ── CSRF ──────────────────────────────────────────────────────────────────────

function csrfToken(): string {
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(CSRF_TOKEN_LENGTH));
    }
    return $_SESSION['csrf_token'];
}

function verifyCsrf(string $token): bool {
    return !empty($_SESSION['csrf_token']) && hash_equals($_SESSION['csrf_token'], $token);
}

function csrfField(): string {
    return '<input type="hidden" name="csrf_token" value="' . htmlspecialchars(csrfToken()) . '">';
}

// ── Access log ────────────────────────────────────────────────────────────────

function logAccess(?int $userId = null): void {
    $ip      = getClientIP();
    $ver     = ipVersion($ip);
    $ua      = $_SERVER['HTTP_USER_AGENT'] ?? '';
    $uri     = $_SERVER['REQUEST_URI'] ?? '';
    try {
        $pdo  = getDB();
        $stmt = $pdo->prepare(
            "INSERT INTO access_logs (user_id, ip_address, ip_version, user_agent, request_uri)
             VALUES (:uid, :ip, :ver, :ua, :uri)"
        );
        $stmt->execute([
            ':uid' => $userId,
            ':ip'  => $ip,
            ':ver' => $ver,
            ':ua'  => mb_substr($ua, 0, 512),
            ':uri' => mb_substr($uri, 0, 512),
        ]);
    } catch (Exception $e) {
        // Non-critical — do not break the request
    }
}

// ── JSON response helpers ─────────────────────────────────────────────────────

function jsonResponse(array $data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function jsonError(string $message, int $code = 400): void {
    jsonResponse(['success' => false, 'error' => $message], $code);
}

function jsonSuccess(array $data = [], string $message = 'OK'): void {
    jsonResponse(array_merge(['success' => true, 'message' => $message], $data));
}

// ── HTML escaping ─────────────────────────────────────────────────────────────

function e(string $value): string {
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

// ── Pagination ────────────────────────────────────────────────────────────────

function paginate(int $total, int $page, int $perPage = 25): array {
    $totalPages = max(1, (int) ceil($total / $perPage));
    $page       = max(1, min($page, $totalPages));
    $offset     = ($page - 1) * $perPage;
    return compact('total', 'page', 'perPage', 'totalPages', 'offset');
}
