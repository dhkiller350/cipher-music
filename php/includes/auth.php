<?php
/**
 * Authentication helpers for the admin panel.
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/functions.php';

function startSecureSession(): void {
    if (session_status() === PHP_SESSION_NONE) {
        session_name(SESSION_NAME);
        session_set_cookie_params([
            'lifetime' => SESSION_LIFETIME,
            'path'     => '/',
            'secure'   => isset($_SERVER['HTTPS']),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_start();
    }
}

function isAdminLoggedIn(): bool {
    startSecureSession();
    return !empty($_SESSION[ADMIN_SESSION_KEY])
        && !empty($_SESSION['admin_id'])
        && !empty($_SESSION['admin_last_active'])
        && (time() - $_SESSION['admin_last_active']) < SESSION_LIFETIME;
}

function requireAdmin(): void {
    if (!isAdminLoggedIn()) {
        header('Location: ' . ADMIN_PATH . '/login.php');
        exit;
    }
    // Refresh activity timestamp
    $_SESSION['admin_last_active'] = time();
}

function adminLogin(string $username, string $password): bool {
    try {
        $pdo  = getDB();
        $stmt = $pdo->prepare("SELECT id, password_hash FROM admins WHERE username = :u LIMIT 1");
        $stmt->execute([':u' => $username]);
        $admin = $stmt->fetch();

        if ($admin && password_verify($password, $admin['password_hash'])) {
            startSecureSession();
            session_regenerate_id(true);

            $_SESSION[ADMIN_SESSION_KEY]  = true;
            $_SESSION['admin_id']         = $admin['id'];
            $_SESSION['admin_username']   = $username;
            $_SESSION['admin_last_active'] = time();

            $ip   = getClientIP();
            $stmt = $pdo->prepare(
                "UPDATE admins SET last_login = NOW(), last_login_ip = :ip WHERE id = :id"
            );
            $stmt->execute([':ip' => $ip, ':id' => $admin['id']]);

            return true;
        }
    } catch (Exception $e) {
        // login failure
    }
    return false;
}

function adminLogout(): void {
    startSecureSession();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params['path'], $params['domain'],
            $params['secure'], $params['httponly']
        );
    }
    session_destroy();
}

/**
 * Verify an API Bearer token for remote API calls.
 */
function requireApiAuth(): void {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+(.+)$/i', $auth, $m)) {
        if (hash_equals(API_SECRET, $m[1])) {
            return;
        }
    }
    jsonError('Unauthorized', 401);
}
