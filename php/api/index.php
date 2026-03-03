<?php
/**
 * REST API router — /api/
 *
 * All endpoints require:
 *   Authorization: Bearer <API_SECRET>
 *
 * Routes:
 *   GET    /api/users                  List users
 *   GET    /api/users/{id}             Get user
 *   POST   /api/users/{id}/ban         Ban user
 *   POST   /api/users/{id}/unban       Unban user
 *   DELETE /api/users/{id}             Soft-delete user
 *
 *   GET    /api/payments               List payments
 *   GET    /api/payments/{id}          Get payment
 *   POST   /api/payments/{id}/revoke   Revoke payment
 *   DELETE /api/payments/{id}          Soft-delete payment
 *
 *   GET    /api/maintenance            Get maintenance status
 *   POST   /api/maintenance/enable     Enable maintenance
 *   POST   /api/maintenance/disable    Disable maintenance
 *
 *   GET    /api/logs                   Recent access logs
 */

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');

require_once __DIR__ . '/../../includes/auth.php';
require_once __DIR__ . '/../../includes/functions.php';

// ── Auth ──────────────────────────────────────────────────────────────────────
requireApiAuth();

// ── Route ─────────────────────────────────────────────────────────────────────
$method = $_SERVER['REQUEST_METHOD'];
$uri    = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Strip /api prefix
$path = preg_replace('#^/api#', '', $uri);
$path = rtrim($path, '/');

$pdo = getDB();

// Helper: read JSON body
function jsonBody(): array {
    $raw = file_get_contents('php://input');
    return json_decode($raw, true) ?? [];
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Maintenance
if ($path === '/maintenance') {
    if ($method !== 'GET') { jsonError('Method not allowed', 405); }
    jsonSuccess(['maintenance' => isMaintenanceMode()], 'OK');
}

if ($path === '/maintenance/enable') {
    if ($method !== 'POST') { jsonError('Method not allowed', 405); }
    setMaintenanceMode(true);
    jsonSuccess(['maintenance' => true], 'Maintenance mode enabled');
}

if ($path === '/maintenance/disable') {
    if ($method !== 'POST') { jsonError('Method not allowed', 405); }
    setMaintenanceMode(false);
    jsonSuccess(['maintenance' => false], 'Maintenance mode disabled');
}

// Users list
if ($path === '/users' && $method === 'GET') {
    $page    = max(1, (int)($_GET['page'] ?? 1));
    $perPage = min(100, max(1, (int)($_GET['per_page'] ?? 25)));
    $status  = $_GET['status'] ?? '';
    $search  = $_GET['q'] ?? '';

    $where  = []; $params = [];
    if (in_array($status, ['active','banned','deleted'], true)) {
        $where[] = "status = :st"; $params[':st'] = $status;
    }
    if ($search !== '') {
        $where[] = "(username LIKE :s OR email LIKE :s)"; $params[':s'] = "%$search%";
    }
    $ws = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $total = (int)$pdo->prepare("SELECT COUNT(*) FROM users $ws")->execute($params)
             ? (function() use ($pdo, $ws, $params) {
                   $s = $pdo->prepare("SELECT COUNT(*) FROM users $ws");
                   $s->execute($params); return (int)$s->fetchColumn();
               })()
             : 0;

    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM users $ws");
    $countStmt->execute($params);
    $total = (int)$countStmt->fetchColumn();

    $pag = paginate($total, $page, $perPage);
    $params[':lim'] = $pag['perPage'];
    $params[':off'] = $pag['offset'];

    $stmt = $pdo->prepare("SELECT id, username, email, status, ban_reason, last_login_ip, created_at, updated_at
                           FROM users $ws ORDER BY created_at DESC LIMIT :lim OFFSET :off");
    foreach ($params as $k => &$v) {
        $stmt->bindValue($k, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
    }
    unset($v);
    $stmt->execute();
    $users = $stmt->fetchAll();

    // Normalize IPs
    foreach ($users as &$u) {
        if ($u['last_login_ip']) {
            $u['last_login_ip'] = normalizeIPv4ToIPv6($u['last_login_ip']);
        }
    }
    unset($u);

    jsonSuccess(['users' => $users, 'pagination' => $pag]);
}

// Single user
if (preg_match('#^/users/(\d+)$#', $path, $m) && $method === 'GET') {
    $uid  = (int)$m[1];
    $stmt = $pdo->prepare("SELECT id, username, email, status, ban_reason, last_login_ip, created_at, updated_at FROM users WHERE id=:id");
    $stmt->execute([':id' => $uid]);
    $user = $stmt->fetch();
    if (!$user) { jsonError('User not found', 404); }
    if ($user['last_login_ip']) {
        $user['last_login_ip'] = normalizeIPv4ToIPv6($user['last_login_ip']);
    }
    jsonSuccess(['user' => $user]);
}

// Ban user
if (preg_match('#^/users/(\d+)/ban$#', $path, $m) && $method === 'POST') {
    $uid    = (int)$m[1];
    $body   = jsonBody();
    $reason = $body['reason'] ?? 'Banned via API';
    $stmt   = $pdo->prepare("UPDATE users SET status='banned', ban_reason=:r WHERE id=:id");
    $stmt->execute([':r' => $reason, ':id' => $uid]);
    if ($stmt->rowCount() === 0) { jsonError('User not found', 404); }
    jsonSuccess([], "User #$uid banned");
}

// Unban user
if (preg_match('#^/users/(\d+)/unban$#', $path, $m) && $method === 'POST') {
    $uid  = (int)$m[1];
    $stmt = $pdo->prepare("UPDATE users SET status='active', ban_reason=NULL WHERE id=:id AND status='banned'");
    $stmt->execute([':id' => $uid]);
    if ($stmt->rowCount() === 0) { jsonError('User not found or not banned', 404); }
    jsonSuccess([], "User #$uid unbanned");
}

// Delete user
if (preg_match('#^/users/(\d+)$#', $path, $m) && $method === 'DELETE') {
    $uid  = (int)$m[1];
    $stmt = $pdo->prepare("UPDATE users SET status='deleted' WHERE id=:id");
    $stmt->execute([':id' => $uid]);
    if ($stmt->rowCount() === 0) { jsonError('User not found', 404); }
    jsonSuccess([], "User #$uid deleted");
}

// Payments list
if ($path === '/payments' && $method === 'GET') {
    $page    = max(1, (int)($_GET['page'] ?? 1));
    $perPage = min(100, max(1, (int)($_GET['per_page'] ?? 25)));
    $status  = $_GET['status'] ?? '';
    $search  = $_GET['q'] ?? '';

    $where  = []; $params = [];
    if (in_array($status, ['pending','completed','revoked','refunded','deleted'], true)) {
        $where[] = "p.status = :st"; $params[':st'] = $status;
    }
    if ($search !== '') {
        $where[] = "(u.username LIKE :s OR p.transaction_id LIKE :s)"; $params[':s'] = "%$search%";
    }
    $ws = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM payments p JOIN users u ON p.user_id=u.id $ws");
    $countStmt->execute($params);
    $total = (int)$countStmt->fetchColumn();

    $pag = paginate($total, $page, $perPage);
    $params[':lim'] = $pag['perPage'];
    $params[':off'] = $pag['offset'];

    $stmt = $pdo->prepare(
        "SELECT p.id, p.user_id, u.username, p.amount, p.currency, p.status,
                p.payment_method, p.transaction_id, p.description, p.revoke_reason,
                p.created_at, p.updated_at
         FROM payments p JOIN users u ON p.user_id=u.id
         $ws ORDER BY p.created_at DESC LIMIT :lim OFFSET :off"
    );
    foreach ($params as $k => &$v) {
        $stmt->bindValue($k, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
    }
    unset($v);
    $stmt->execute();
    $payments = $stmt->fetchAll();

    jsonSuccess(['payments' => $payments, 'pagination' => $pag]);
}

// Single payment
if (preg_match('#^/payments/(\d+)$#', $path, $m) && $method === 'GET') {
    $pid  = (int)$m[1];
    $stmt = $pdo->prepare(
        "SELECT p.*, u.username, u.email
         FROM payments p JOIN users u ON p.user_id=u.id WHERE p.id=:id"
    );
    $stmt->execute([':id' => $pid]);
    $payment = $stmt->fetch();
    if (!$payment) { jsonError('Payment not found', 404); }
    jsonSuccess(['payment' => $payment]);
}

// Revoke payment
if (preg_match('#^/payments/(\d+)/revoke$#', $path, $m) && $method === 'POST') {
    $pid    = (int)$m[1];
    $body   = jsonBody();
    $reason = $body['reason'] ?? 'Revoked via API';
    $stmt   = $pdo->prepare(
        "UPDATE payments SET status='revoked', revoke_reason=:r WHERE id=:id AND status != 'revoked'"
    );
    $stmt->execute([':r' => $reason, ':id' => $pid]);
    if ($stmt->rowCount() === 0) { jsonError('Payment not found or already revoked', 404); }
    jsonSuccess([], "Payment #$pid revoked");
}

// Delete payment
if (preg_match('#^/payments/(\d+)$#', $path, $m) && $method === 'DELETE') {
    $pid  = (int)$m[1];
    $stmt = $pdo->prepare("UPDATE payments SET status='deleted' WHERE id=:id");
    $stmt->execute([':id' => $pid]);
    if ($stmt->rowCount() === 0) { jsonError('Payment not found', 404); }
    jsonSuccess([], "Payment #$pid deleted");
}

// Access logs
if ($path === '/logs' && $method === 'GET') {
    $page    = max(1, (int)($_GET['page'] ?? 1));
    $perPage = min(200, max(1, (int)($_GET['per_page'] ?? 50)));
    $ipFilter = $_GET['ip'] ?? '';

    $where = []; $params = [];
    if ($ipFilter !== '') {
        $where[] = "l.ip_address LIKE :ip"; $params[':ip'] = "%$ipFilter%";
    }
    $ws = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM access_logs l $ws");
    $countStmt->execute($params);
    $total = (int)$countStmt->fetchColumn();

    $pag = paginate($total, $page, $perPage);
    $params[':lim'] = $pag['perPage'];
    $params[':off'] = $pag['offset'];

    $stmt = $pdo->prepare(
        "SELECT l.id, l.user_id, u.username, l.ip_address, l.ip_version,
                l.request_uri, l.created_at
         FROM access_logs l LEFT JOIN users u ON l.user_id=u.id
         $ws ORDER BY l.created_at DESC LIMIT :lim OFFSET :off"
    );
    foreach ($params as $k => &$v) {
        $stmt->bindValue($k, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
    }
    unset($v);
    $stmt->execute();
    $logs = $stmt->fetchAll();

    foreach ($logs as &$l) {
        $l['ip_address'] = normalizeIPv4ToIPv6($l['ip_address']);
    }
    unset($l);

    jsonSuccess(['logs' => $logs, 'pagination' => $pag]);
}

// 404
jsonError('Endpoint not found', 404);
