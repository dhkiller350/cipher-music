<?php
/**
 * Admin — User Management
 * Actions: list, view detail, ban, unban, delete
 */

require_once __DIR__ . '/layout.php';

$pdo    = getDB();
$msg    = '';
$msgType = 'success';

// ── Handle POST actions ───────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!verifyCsrf($_POST['csrf_token'] ?? '')) {
        $msg = 'Invalid CSRF token.'; $msgType = 'danger';
    } else {
        $action = $_POST['action'] ?? '';
        $uid    = (int)($_POST['user_id'] ?? 0);
        $reason = trim($_POST['reason'] ?? '');

        if ($uid > 0) {
            switch ($action) {
                case 'ban':
                    $stmt = $pdo->prepare("UPDATE users SET status='banned', ban_reason=:r WHERE id=:id");
                    $stmt->execute([':r' => $reason ?: 'Banned by admin', ':id' => $uid]);
                    $msg = "User #$uid has been banned.";
                    break;

                case 'unban':
                    $stmt = $pdo->prepare("UPDATE users SET status='active', ban_reason=NULL WHERE id=:id AND status='banned'");
                    $stmt->execute([':id' => $uid]);
                    $msg = "User #$uid has been unbanned.";
                    break;

                case 'delete':
                    $stmt = $pdo->prepare("UPDATE users SET status='deleted' WHERE id=:id");
                    $stmt->execute([':id' => $uid]);
                    $msg = "User #$uid has been deleted.";
                    break;

                case 'hard_delete':
                    $stmt = $pdo->prepare("DELETE FROM users WHERE id=:id");
                    $stmt->execute([':id' => $uid]);
                    $msg = "User #$uid permanently removed.";
                    break;

                default:
                    $msg = 'Unknown action.'; $msgType = 'warning';
            }
        }
    }
}

// ── Detail view ───────────────────────────────────────────────────────────────
$viewUser = null;
if (isset($_GET['id'])) {
    $stmt = $pdo->prepare("SELECT * FROM users WHERE id = :id");
    $stmt->execute([':id' => (int)$_GET['id']]);
    $viewUser = $stmt->fetch();
}

// ── List view ─────────────────────────────────────────────────────────────────
$search  = trim($_GET['q'] ?? '');
$status  = $_GET['status'] ?? '';
$page    = max(1, (int)($_GET['page'] ?? 1));
$perPage = 25;

$where  = [];
$params = [];

if ($search !== '') {
    $where[]         = "(username LIKE :s OR email LIKE :s)";
    $params[':s']    = "%$search%";
}
if (in_array($status, ['active','banned','deleted'], true)) {
    $where[]           = "status = :st";
    $params[':st']     = $status;
}

$whereSQL = $where ? 'WHERE ' . implode(' AND ', $where) : '';
$total    = (int)$pdo->prepare("SELECT COUNT(*) FROM users $whereSQL")->execute($params)
          ? (int)$pdo->prepare("SELECT COUNT(*) FROM users $whereSQL")->execute($params)
            ?: 0
          : 0;

// Fix: execute + fetch count properly
$countStmt = $pdo->prepare("SELECT COUNT(*) FROM users $whereSQL");
$countStmt->execute($params);
$total = (int)$countStmt->fetchColumn();

$pag    = paginate($total, $page, $perPage);
$params[':lim'] = $pag['perPage'];
$params[':off'] = $pag['offset'];

$stmt = $pdo->prepare("SELECT * FROM users $whereSQL ORDER BY created_at DESC LIMIT :lim OFFSET :off");
foreach ($params as $k => &$v) {
    $stmt->bindValue($k, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
}
unset($v);
$stmt->execute();
$users = $stmt->fetchAll();

adminHeader('Users', 'users');
?>

<?php if ($msg): ?>
    <div class="alert alert-<?= e($msgType) ?>" data-auto-dismiss><?= e($msg) ?></div>
<?php endif; ?>

<?php if ($viewUser): ?>
<!-- ── Detail view ── -->
<div class="topbar">
    <h1>User: <?= e($viewUser['username']) ?></h1>
    <a href="/admin/users.php" class="btn btn-sm btn-primary">← Back to Users</a>
</div>

<div class="card">
    <table style="width:100%;max-width:640px">
        <tr><td style="color:var(--text-muted);width:180px">ID</td><td><?= e((string)$viewUser['id']) ?></td></tr>
        <tr><td style="color:var(--text-muted)">Username</td><td><?= e($viewUser['username']) ?></td></tr>
        <tr><td style="color:var(--text-muted)">Email</td><td><?= e($viewUser['email']) ?></td></tr>
        <tr><td style="color:var(--text-muted)">Status</td><td><span class="badge badge-<?= e($viewUser['status']) ?>"><?= e($viewUser['status']) ?></span></td></tr>
        <tr><td style="color:var(--text-muted)">Ban Reason</td><td><?= e($viewUser['ban_reason'] ?? '—') ?></td></tr>
        <tr><td style="color:var(--text-muted)">Last Login IP</td><td class="ip-v6"><?= e($viewUser['last_login_ip'] ? normalizeIPv4ToIPv6($viewUser['last_login_ip']) : '—') ?></td></tr>
        <tr><td style="color:var(--text-muted)">Last Login</td><td><?= e($viewUser['last_login'] ?? '—') ?></td></tr>
        <tr><td style="color:var(--text-muted)">Joined</td><td><?= e($viewUser['created_at']) ?></td></tr>
    </table>

    <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
        <?php if ($viewUser['status'] !== 'banned'): ?>
        <button class="btn btn-warning" onclick="openModal('modal-ban', <?= (int)$viewUser['id'] ?>)">🚫 Ban User</button>
        <?php else: ?>
        <form method="POST">
            <?= csrfField() ?>
            <input type="hidden" name="action" value="unban">
            <input type="hidden" name="user_id" value="<?= (int)$viewUser['id'] ?>">
            <button type="submit" class="btn btn-success">✅ Unban User</button>
        </form>
        <?php endif; ?>

        <button class="btn btn-danger" onclick="openModal('modal-delete', <?= (int)$viewUser['id'] ?>)">🗑️ Delete User</button>
    </div>
</div>

<!-- Payments for this user -->
<?php
$upay = $pdo->prepare("SELECT * FROM payments WHERE user_id = :id ORDER BY created_at DESC");
$upay->execute([':id' => $viewUser['id']]);
$userPayments = $upay->fetchAll();
?>
<div class="card">
    <div class="card-title">Payments (<?= count($userPayments) ?>)</div>
    <div class="table-wrap">
        <table>
            <thead><tr><th>#</th><th>Amount</th><th>Currency</th><th>Status</th><th>Tx ID</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>
            <?php foreach ($userPayments as $p): ?>
                <tr>
                    <td><?= e((string)$p['id']) ?></td>
                    <td><?= e(number_format((float)$p['amount'], 2)) ?></td>
                    <td><?= e($p['currency']) ?></td>
                    <td><span class="badge badge-<?= e($p['status']) ?>"><?= e($p['status']) ?></span></td>
                    <td><?= e($p['transaction_id'] ?? '—') ?></td>
                    <td><?= e(date('Y-m-d', strtotime($p['created_at']))) ?></td>
                    <td><a href="/admin/payments.php?id=<?= (int)$p['id'] ?>" class="btn btn-sm btn-info">View</a></td>
                </tr>
            <?php endforeach; ?>
            <?php if (empty($userPayments)): ?>
                <tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No payments.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>

<?php else: ?>
<!-- ── List view ── -->
<div class="topbar">
    <h1>Users</h1>
    <form class="search-bar" method="GET">
        <input type="text" name="q" class="form-control" placeholder="Search username/email…" value="<?= e($search) ?>">
        <select name="status" class="form-control" style="width:130px">
            <option value="">All Status</option>
            <option value="active"  <?= $status === 'active'  ? 'selected' : '' ?>>Active</option>
            <option value="banned"  <?= $status === 'banned'  ? 'selected' : '' ?>>Banned</option>
            <option value="deleted" <?= $status === 'deleted' ? 'selected' : '' ?>>Deleted</option>
        </select>
        <button type="submit" class="btn btn-primary">Filter</button>
        <?php if ($search || $status): ?>
            <a href="/admin/users.php" class="btn btn-sm" style="background:var(--bg3)">Clear</a>
        <?php endif; ?>
    </form>
</div>

<div class="card" style="padding:0;overflow:hidden">
    <div class="table-wrap">
        <table>
            <thead>
                <tr><th>#</th><th>Username</th><th>Email</th><th>Status</th><th>Last IP</th><th>Joined</th><th>Actions</th></tr>
            </thead>
            <tbody>
            <?php foreach ($users as $u): ?>
                <tr>
                    <td><?= e((string)$u['id']) ?></td>
                    <td><?= e($u['username']) ?></td>
                    <td><?= e($u['email']) ?></td>
                    <td><span class="badge badge-<?= e($u['status']) ?>"><?= e($u['status']) ?></span></td>
                    <td class="ip-v6"><?= e($u['last_login_ip'] ? normalizeIPv4ToIPv6($u['last_login_ip']) : '—') ?></td>
                    <td><?= e(date('Y-m-d', strtotime($u['created_at']))) ?></td>
                    <td style="display:flex;gap:6px;flex-wrap:wrap">
                        <a href="?id=<?= (int)$u['id'] ?>" class="btn btn-sm btn-info">View</a>
                        <?php if ($u['status'] !== 'banned'): ?>
                            <button class="btn btn-sm btn-warning" onclick="openModal('modal-ban', <?= (int)$u['id'] ?>)">Ban</button>
                        <?php else: ?>
                            <form method="POST" style="display:inline">
                                <?= csrfField() ?>
                                <input type="hidden" name="action" value="unban">
                                <input type="hidden" name="user_id" value="<?= (int)$u['id'] ?>">
                                <button type="submit" class="btn btn-sm btn-success">Unban</button>
                            </form>
                        <?php endif; ?>
                        <button class="btn btn-sm btn-danger" onclick="openModal('modal-delete', <?= (int)$u['id'] ?>)">Delete</button>
                    </td>
                </tr>
            <?php endforeach; ?>
            <?php if (empty($users)): ?>
                <tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">No users found.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>

<!-- Pagination -->
<?php if ($pag['totalPages'] > 1): ?>
<div class="pagination">
    <?php for ($i = 1; $i <= $pag['totalPages']; $i++): ?>
        <?php $q = http_build_query(array_merge($_GET, ['page' => $i])); ?>
        <?php if ($i === $pag['page']): ?>
            <span class="current"><?= $i ?></span>
        <?php else: ?>
            <a href="?<?= $q ?>"><?= $i ?></a>
        <?php endif; ?>
    <?php endfor; ?>
</div>
<?php endif; ?>
<?php endif; // end list/detail toggle ?>

<!-- ── Modals ── -->
<div class="modal-overlay" id="modal-ban">
    <div class="modal">
        <h2>🚫 Ban User</h2>
        <form method="POST">
            <?= csrfField() ?>
            <input type="hidden" name="action" value="ban">
            <input type="hidden" name="user_id" id="ban-user-id" value="">
            <div class="form-group">
                <label>Reason (optional)</label>
                <textarea name="reason" class="form-control" placeholder="Ban reason…"></textarea>
            </div>
            <div class="actions">
                <button type="button" class="btn btn-sm" onclick="closeModal('modal-ban')" style="background:var(--bg3)">Cancel</button>
                <button type="submit" class="btn btn-warning">Confirm Ban</button>
            </div>
        </form>
    </div>
</div>

<div class="modal-overlay" id="modal-delete">
    <div class="modal">
        <h2>🗑️ Delete User</h2>
        <p style="color:var(--text-muted);margin-bottom:16px">
            This will soft-delete the user (mark as deleted). Their data will be retained.
        </p>
        <form method="POST">
            <?= csrfField() ?>
            <input type="hidden" name="action" value="delete">
            <input type="hidden" name="user_id" id="delete-user-id" value="">
            <div class="actions">
                <button type="button" class="btn btn-sm" onclick="closeModal('modal-delete')" style="background:var(--bg3)">Cancel</button>
                <button type="submit" class="btn btn-danger">Delete User</button>
            </div>
        </form>
    </div>
</div>

<script>
function openModal(id, userId) {
    document.getElementById(id).classList.add('open');
    var inp = document.getElementById(id.replace('modal-', '') + '-user-id');
    if (inp) inp.value = userId;
}
function closeModal(id) {
    document.getElementById(id).classList.remove('open');
}
// Close on backdrop click
document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.classList.remove('open');
    });
});
</script>

<?php adminFooter(); ?>
