<?php
/**
 * Admin Dashboard
 */

require_once __DIR__ . '/layout.php';

adminHeader('Dashboard', 'dashboard');

$pdo = getDB();

// Stats
$totalUsers    = $pdo->query("SELECT COUNT(*) FROM users")->fetchColumn();
$activeUsers   = $pdo->query("SELECT COUNT(*) FROM users WHERE status = 'active'")->fetchColumn();
$bannedUsers   = $pdo->query("SELECT COUNT(*) FROM users WHERE status = 'banned'")->fetchColumn();
$totalPayments = $pdo->query("SELECT COUNT(*) FROM payments")->fetchColumn();
$totalRevenue  = $pdo->query("SELECT COALESCE(SUM(amount),0) FROM payments WHERE status = 'completed'")->fetchColumn();
$pendingPay    = $pdo->query("SELECT COUNT(*) FROM payments WHERE status = 'pending'")->fetchColumn();

// Recent users
$recentUsers = $pdo->query(
    "SELECT id, username, email, status, last_login_ip, created_at
     FROM users ORDER BY created_at DESC LIMIT 5"
)->fetchAll();

// Recent payments
$recentPayments = $pdo->query(
    "SELECT p.id, u.username, p.amount, p.currency, p.status, p.created_at
     FROM payments p JOIN users u ON p.user_id = u.id
     ORDER BY p.created_at DESC LIMIT 5"
)->fetchAll();

// Maintenance status
$maint = isMaintenanceMode();
?>

<div class="topbar">
    <h1>Dashboard</h1>
    <div>
        <a href="/admin/maintenance.php" class="btn <?= $maint ? 'btn-warning' : 'btn-success' ?>">
            <?= $maint ? '🔧 Disable Maintenance' : '✅ Enable Maintenance' ?>
        </a>
    </div>
</div>

<!-- Stats -->
<div class="stats-grid">
    <div class="stat-box">
        <div class="num"><?= e((string)$totalUsers) ?></div>
        <div class="lbl">Total Users</div>
    </div>
    <div class="stat-box">
        <div class="num"><?= e((string)$activeUsers) ?></div>
        <div class="lbl">Active Users</div>
    </div>
    <div class="stat-box">
        <div class="num"><?= e((string)$bannedUsers) ?></div>
        <div class="lbl">Banned Users</div>
    </div>
    <div class="stat-box">
        <div class="num"><?= e((string)$totalPayments) ?></div>
        <div class="lbl">Total Payments</div>
    </div>
    <div class="stat-box">
        <div class="num">$<?= e(number_format((float)$totalRevenue, 2)) ?></div>
        <div class="lbl">Total Revenue</div>
    </div>
    <div class="stat-box">
        <div class="num"><?= e((string)$pendingPay) ?></div>
        <div class="lbl">Pending Payments</div>
    </div>
</div>

<!-- Recent Users -->
<div class="card">
    <div class="card-title">Recent Users</div>
    <div class="table-wrap">
        <table>
            <thead>
                <tr>
                    <th>#</th><th>Username</th><th>Email</th><th>Status</th><th>Last IP</th><th>Joined</th><th>Actions</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($recentUsers as $u): ?>
                <tr>
                    <td><?= e((string)$u['id']) ?></td>
                    <td><?= e($u['username']) ?></td>
                    <td><?= e($u['email']) ?></td>
                    <td><span class="badge badge-<?= e($u['status']) ?>"><?= e($u['status']) ?></span></td>
                    <td class="ip-v6"><?= e($u['last_login_ip'] ? normalizeIPv4ToIPv6($u['last_login_ip']) : '—') ?></td>
                    <td><?= e(date('Y-m-d', strtotime($u['created_at']))) ?></td>
                    <td>
                        <a href="/admin/users.php?id=<?= (int)$u['id'] ?>" class="btn btn-sm btn-info">View</a>
                    </td>
                </tr>
            <?php endforeach; ?>
            <?php if (empty($recentUsers)): ?>
                <tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No users yet.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
    <a href="/admin/users.php" class="btn btn-sm btn-primary" style="margin-top:12px">View All Users</a>
</div>

<!-- Recent Payments -->
<div class="card">
    <div class="card-title">Recent Payments</div>
    <div class="table-wrap">
        <table>
            <thead>
                <tr>
                    <th>#</th><th>User</th><th>Amount</th><th>Status</th><th>Date</th><th>Actions</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($recentPayments as $p): ?>
                <tr>
                    <td><?= e((string)$p['id']) ?></td>
                    <td><?= e($p['username']) ?></td>
                    <td><?= e($p['currency']) ?> <?= e(number_format((float)$p['amount'], 2)) ?></td>
                    <td><span class="badge badge-<?= e($p['status']) ?>"><?= e($p['status']) ?></span></td>
                    <td><?= e(date('Y-m-d', strtotime($p['created_at']))) ?></td>
                    <td>
                        <a href="/admin/payments.php?id=<?= (int)$p['id'] ?>" class="btn btn-sm btn-info">View</a>
                    </td>
                </tr>
            <?php endforeach; ?>
            <?php if (empty($recentPayments)): ?>
                <tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No payments yet.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
    <a href="/admin/payments.php" class="btn btn-sm btn-primary" style="margin-top:12px">View All Payments</a>
</div>

<?php adminFooter(); ?>
