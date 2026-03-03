<?php
/**
 * Admin — Payment Management
 * Actions: list, view detail, revoke, delete
 */

require_once __DIR__ . '/layout.php';

$pdo     = getDB();
$msg     = '';
$msgType = 'success';

// ── POST actions ──────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!verifyCsrf($_POST['csrf_token'] ?? '')) {
        $msg = 'Invalid CSRF token.'; $msgType = 'danger';
    } else {
        $action = $_POST['action'] ?? '';
        $pid    = (int)($_POST['payment_id'] ?? 0);
        $reason = trim($_POST['reason'] ?? '');

        if ($pid > 0) {
            switch ($action) {
                case 'revoke':
                    $stmt = $pdo->prepare(
                        "UPDATE payments SET status='revoked', revoke_reason=:r WHERE id=:id AND status != 'revoked'"
                    );
                    $stmt->execute([':r' => $reason ?: 'Revoked by admin', ':id' => $pid]);
                    $msg = "Payment #$pid has been revoked.";
                    break;

                case 'delete':
                    $stmt = $pdo->prepare("UPDATE payments SET status='deleted' WHERE id=:id");
                    $stmt->execute([':id' => $pid]);
                    $msg = "Payment #$pid deleted.";
                    break;

                case 'hard_delete':
                    $stmt = $pdo->prepare("DELETE FROM payments WHERE id=:id");
                    $stmt->execute([':id' => $pid]);
                    $msg = "Payment #$pid permanently removed.";
                    break;

                case 'complete':
                    $stmt = $pdo->prepare("UPDATE payments SET status='completed' WHERE id=:id AND status = 'pending'");
                    $stmt->execute([':id' => $pid]);
                    $msg = "Payment #$pid marked as completed.";
                    break;

                default:
                    $msg = 'Unknown action.'; $msgType = 'warning';
            }
        }
    }
}

// ── Detail view ───────────────────────────────────────────────────────────────
$viewPayment = null;
$viewUser    = null;
if (isset($_GET['id'])) {
    $stmt = $pdo->prepare(
        "SELECT p.*, u.username, u.email
         FROM payments p JOIN users u ON p.user_id = u.id
         WHERE p.id = :id"
    );
    $stmt->execute([':id' => (int)$_GET['id']]);
    $viewPayment = $stmt->fetch();
}

// ── List view ─────────────────────────────────────────────────────────────────
$search  = trim($_GET['q'] ?? '');
$status  = $_GET['status'] ?? '';
$page    = max(1, (int)($_GET['page'] ?? 1));
$perPage = 25;

$where  = [];
$params = [];

if ($search !== '') {
    $where[]      = "(u.username LIKE :s OR p.transaction_id LIKE :s)";
    $params[':s'] = "%$search%";
}
if (in_array($status, ['pending','completed','revoked','refunded','deleted'], true)) {
    $where[]      = "p.status = :st";
    $params[':st'] = $status;
}

$whereSQL  = $where ? 'WHERE ' . implode(' AND ', $where) : '';
$countStmt = $pdo->prepare(
    "SELECT COUNT(*) FROM payments p JOIN users u ON p.user_id = u.id $whereSQL"
);
$countStmt->execute($params);
$total = (int)$countStmt->fetchColumn();

$pag             = paginate($total, $page, $perPage);
$params[':lim']  = $pag['perPage'];
$params[':off']  = $pag['offset'];

$stmt = $pdo->prepare(
    "SELECT p.*, u.username
     FROM payments p JOIN users u ON p.user_id = u.id
     $whereSQL ORDER BY p.created_at DESC LIMIT :lim OFFSET :off"
);
foreach ($params as $k => &$v) {
    $stmt->bindValue($k, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
}
unset($v);
$stmt->execute();
$payments = $stmt->fetchAll();

adminHeader('Payments', 'payments');
?>

<?php if ($msg): ?>
    <div class="alert alert-<?= e($msgType) ?>" data-auto-dismiss><?= e($msg) ?></div>
<?php endif; ?>

<?php if ($viewPayment): ?>
<!-- ── Detail view ── -->
<div class="topbar">
    <h1>Payment #<?= e((string)$viewPayment['id']) ?></h1>
    <a href="/admin/payments.php" class="btn btn-sm btn-primary">← Back to Payments</a>
</div>
<div class="card">
    <table style="width:100%;max-width:640px">
        <tr><td style="color:var(--text-muted);width:180px">ID</td><td><?= e((string)$viewPayment['id']) ?></td></tr>
        <tr><td style="color:var(--text-muted)">User</td>
            <td><a href="/admin/users.php?id=<?= (int)$viewPayment['user_id'] ?>"><?= e($viewPayment['username']) ?></a></td></tr>
        <tr><td style="color:var(--text-muted)">Amount</td><td><?= e($viewPayment['currency']) ?> <?= e(number_format((float)$viewPayment['amount'], 2)) ?></td></tr>
        <tr><td style="color:var(--text-muted)">Status</td><td><span class="badge badge-<?= e($viewPayment['status']) ?>"><?= e($viewPayment['status']) ?></span></td></tr>
        <tr><td style="color:var(--text-muted)">Method</td><td><?= e($viewPayment['payment_method'] ?? '—') ?></td></tr>
        <tr><td style="color:var(--text-muted)">Transaction ID</td><td><?= e($viewPayment['transaction_id'] ?? '—') ?></td></tr>
        <tr><td style="color:var(--text-muted)">Description</td><td><?= e($viewPayment['description'] ?? '—') ?></td></tr>
        <tr><td style="color:var(--text-muted)">Revoke Reason</td><td><?= e($viewPayment['revoke_reason'] ?? '—') ?></td></tr>
        <tr><td style="color:var(--text-muted)">Created</td><td><?= e($viewPayment['created_at']) ?></td></tr>
        <tr><td style="color:var(--text-muted)">Updated</td><td><?= e($viewPayment['updated_at']) ?></td></tr>
    </table>

    <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
        <?php if ($viewPayment['status'] === 'pending'): ?>
            <form method="POST" style="display:inline">
                <?= csrfField() ?>
                <input type="hidden" name="action" value="complete">
                <input type="hidden" name="payment_id" value="<?= (int)$viewPayment['id'] ?>">
                <button type="submit" class="btn btn-success">✅ Mark Completed</button>
            </form>
        <?php endif; ?>
        <?php if (!in_array($viewPayment['status'], ['revoked','deleted'], true)): ?>
            <button class="btn btn-warning" onclick="openModal('modal-revoke', <?= (int)$viewPayment['id'] ?>)">🚫 Revoke</button>
        <?php endif; ?>
        <button class="btn btn-danger" onclick="openModal('modal-delete', <?= (int)$viewPayment['id'] ?>)">🗑️ Delete</button>
    </div>
</div>

<?php else: ?>
<!-- ── List view ── -->
<div class="topbar">
    <h1>Payments</h1>
    <form class="search-bar" method="GET">
        <input type="text" name="q" class="form-control" placeholder="Search username/tx id…" value="<?= e($search) ?>">
        <select name="status" class="form-control" style="width:140px">
            <option value="">All Status</option>
            <?php foreach (['pending','completed','revoked','refunded','deleted'] as $s): ?>
                <option value="<?= $s ?>" <?= $status === $s ? 'selected' : '' ?>><?= ucfirst($s) ?></option>
            <?php endforeach; ?>
        </select>
        <button type="submit" class="btn btn-primary">Filter</button>
        <?php if ($search || $status): ?>
            <a href="/admin/payments.php" class="btn btn-sm" style="background:var(--bg3)">Clear</a>
        <?php endif; ?>
    </form>
</div>

<div class="card" style="padding:0;overflow:hidden">
    <div class="table-wrap">
        <table>
            <thead>
                <tr><th>#</th><th>User</th><th>Amount</th><th>Status</th><th>Tx ID</th><th>Date</th><th>Actions</th></tr>
            </thead>
            <tbody>
            <?php foreach ($payments as $p): ?>
                <tr>
                    <td><?= e((string)$p['id']) ?></td>
                    <td><a href="/admin/users.php?id=<?= (int)$p['user_id'] ?>"><?= e($p['username']) ?></a></td>
                    <td><?= e($p['currency']) ?> <?= e(number_format((float)$p['amount'], 2)) ?></td>
                    <td><span class="badge badge-<?= e($p['status']) ?>"><?= e($p['status']) ?></span></td>
                    <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis"><?= e($p['transaction_id'] ?? '—') ?></td>
                    <td><?= e(date('Y-m-d', strtotime($p['created_at']))) ?></td>
                    <td style="display:flex;gap:6px;flex-wrap:wrap">
                        <a href="?id=<?= (int)$p['id'] ?>" class="btn btn-sm btn-info">View</a>
                        <?php if (!in_array($p['status'], ['revoked','deleted'], true)): ?>
                            <button class="btn btn-sm btn-warning" onclick="openModal('modal-revoke', <?= (int)$p['id'] ?>)">Revoke</button>
                        <?php endif; ?>
                        <button class="btn btn-sm btn-danger" onclick="openModal('modal-delete', <?= (int)$p['id'] ?>)">Delete</button>
                    </td>
                </tr>
            <?php endforeach; ?>
            <?php if (empty($payments)): ?>
                <tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">No payments found.</td></tr>
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
<div class="modal-overlay" id="modal-revoke">
    <div class="modal">
        <h2>🚫 Revoke Payment</h2>
        <form method="POST">
            <?= csrfField() ?>
            <input type="hidden" name="action" value="revoke">
            <input type="hidden" name="payment_id" id="revoke-payment-id" value="">
            <div class="form-group">
                <label>Reason (optional)</label>
                <textarea name="reason" class="form-control" placeholder="Revoke reason…"></textarea>
            </div>
            <div class="actions">
                <button type="button" class="btn btn-sm" onclick="closeModal('modal-revoke')" style="background:var(--bg3)">Cancel</button>
                <button type="submit" class="btn btn-warning">Confirm Revoke</button>
            </div>
        </form>
    </div>
</div>

<div class="modal-overlay" id="modal-delete">
    <div class="modal">
        <h2>🗑️ Delete Payment</h2>
        <p style="color:var(--text-muted);margin-bottom:16px">
            This will soft-delete the payment record.
        </p>
        <form method="POST">
            <?= csrfField() ?>
            <input type="hidden" name="action" value="delete">
            <input type="hidden" name="payment_id" id="delete-payment-id" value="">
            <div class="actions">
                <button type="button" class="btn btn-sm" onclick="closeModal('modal-delete')" style="background:var(--bg3)">Cancel</button>
                <button type="submit" class="btn btn-danger">Delete Payment</button>
            </div>
        </form>
    </div>
</div>

<script>
function openModal(id, payId) {
    document.getElementById(id).classList.add('open');
    var inp = document.getElementById(id.replace('modal-','') + '-payment-id');
    if (inp) inp.value = payId;
}
function closeModal(id) {
    document.getElementById(id).classList.remove('open');
}
document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.classList.remove('open');
    });
});
</script>

<?php adminFooter(); ?>
