<?php
/**
 * Admin — Access Logs (shows IPv6 addresses)
 */

require_once __DIR__ . '/layout.php';

$pdo     = getDB();
$page    = max(1, (int)($_GET['page'] ?? 1));
$perPage = 50;
$ipFilter = trim($_GET['ip'] ?? '');

$where  = [];
$params = [];

if ($ipFilter !== '') {
    $where[]      = "l.ip_address LIKE :ip";
    $params[':ip'] = "%$ipFilter%";
}

$whereSQL  = $where ? 'WHERE ' . implode(' AND ', $where) : '';
$countStmt = $pdo->prepare("SELECT COUNT(*) FROM access_logs l $whereSQL");
$countStmt->execute($params);
$total = (int)$countStmt->fetchColumn();

$pag            = paginate($total, $page, $perPage);
$params[':lim'] = $pag['perPage'];
$params[':off'] = $pag['offset'];

$stmt = $pdo->prepare(
    "SELECT l.*, u.username
     FROM access_logs l
     LEFT JOIN users u ON l.user_id = u.id
     $whereSQL
     ORDER BY l.created_at DESC LIMIT :lim OFFSET :off"
);
foreach ($params as $k => &$v) {
    $stmt->bindValue($k, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
}
unset($v);
$stmt->execute();
$logs = $stmt->fetchAll();

adminHeader('Access Logs', 'logs');
?>

<div class="topbar">
    <h1>📋 Access Logs</h1>
    <form class="search-bar" method="GET">
        <input type="text" name="ip" class="form-control" placeholder="Filter by IP…" value="<?= e($ipFilter) ?>">
        <button type="submit" class="btn btn-primary">Filter</button>
        <?php if ($ipFilter): ?>
            <a href="/admin/logs.php" class="btn btn-sm" style="background:var(--bg3)">Clear</a>
        <?php endif; ?>
    </form>
</div>

<div class="card" style="padding:0;overflow:hidden">
    <div class="table-wrap">
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>IP Address (IPv6)</th>
                    <th>Ver</th>
                    <th>User</th>
                    <th>URI</th>
                    <th>User Agent</th>
                    <th>Time</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($logs as $l): ?>
                <?php $displayIP = ($l['ip_version'] == 6)
                    ? formatIPv6($l['ip_address'])
                    : normalizeIPv4ToIPv6($l['ip_address']); ?>
                <tr>
                    <td><?= e((string)$l['id']) ?></td>
                    <td class="ip-v6"><?= e($displayIP) ?></td>
                    <td>IPv<?= (int)$l['ip_version'] ?></td>
                    <td><?= $l['username'] ? e($l['username']) : '<span style="color:var(--text-muted)">Guest</span>' ?></td>
                    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis"><?= e($l['request_uri'] ?? '') ?></td>
                    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;font-size:.78rem;color:var(--text-muted)"><?= e($l['user_agent'] ?? '') ?></td>
                    <td style="white-space:nowrap"><?= e($l['created_at']) ?></td>
                </tr>
            <?php endforeach; ?>
            <?php if (empty($logs)): ?>
                <tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">No logs found.</td></tr>
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

<?php adminFooter(); ?>
