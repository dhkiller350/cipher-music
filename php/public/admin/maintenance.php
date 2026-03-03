<?php
/**
 * Admin — Maintenance Mode Control
 * Toggle maintenance from the admin panel (web) or via the shell script (terminal).
 */

require_once __DIR__ . '/layout.php';

$pdo     = getDB();
$msg     = '';
$msgType = 'success';

// Handle POST toggle
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!verifyCsrf($_POST['csrf_token'] ?? '')) {
        $msg = 'Invalid CSRF token.'; $msgType = 'danger';
    } else {
        $action = $_POST['action'] ?? '';

        switch ($action) {
            case 'enable':
                setMaintenanceMode(true);
                $msg = 'Maintenance mode ENABLED. The site is now hidden from visitors.';
                break;

            case 'disable':
                setMaintenanceMode(false);
                $msg = 'Maintenance mode DISABLED. The site is now live.';
                break;

            case 'update_message':
                $newMsg = trim($_POST['maintenance_message'] ?? '');
                if ($newMsg !== '') {
                    $stmt = $pdo->prepare(
                        "INSERT INTO settings (name, value) VALUES ('maintenance_message', :v)
                         ON DUPLICATE KEY UPDATE value = :v"
                    );
                    $stmt->execute([':v' => $newMsg]);
                    $msg = 'Maintenance message updated.';
                }
                break;
        }
    }
}

$maint = isMaintenanceMode();

$maintMsgRow = $pdo->query("SELECT value FROM settings WHERE name = 'maintenance_message'")->fetch();
$maintMsg    = $maintMsgRow ? $maintMsgRow['value'] : '';

adminHeader('Maintenance Mode', 'maintenance');
?>

<?php if ($msg): ?>
    <div class="alert alert-<?= e($msgType) ?>" data-auto-dismiss><?= e($msg) ?></div>
<?php endif; ?>

<div class="topbar"><h1>🔧 Maintenance Mode</h1></div>

<div class="card" style="max-width:640px">
    <div class="card-title">Current Status</div>

    <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px">
        <div style="width:18px;height:18px;border-radius:50%;background:<?= $maint ? 'var(--warning)' : 'var(--success)' ?>"></div>
        <strong style="font-size:1.1rem"><?= $maint ? '⚠️ Maintenance mode is ACTIVE' : '✅ Site is LIVE' ?></strong>
    </div>

    <p style="color:var(--text-muted);margin-bottom:20px">
        When maintenance mode is active, visitors will see the maintenance page.
        The admin panel remains fully accessible.
    </p>

    <form method="POST">
        <?= csrfField() ?>
        <?php if ($maint): ?>
            <input type="hidden" name="action" value="disable">
            <button type="submit" class="btn btn-success">✅ Disable Maintenance Mode (Go Live)</button>
        <?php else: ?>
            <input type="hidden" name="action" value="enable">
            <button type="submit" class="btn btn-warning">🔧 Enable Maintenance Mode</button>
        <?php endif; ?>
    </form>
</div>

<div class="card" style="max-width:640px">
    <div class="card-title">Maintenance Message</div>
    <form method="POST">
        <?= csrfField() ?>
        <input type="hidden" name="action" value="update_message">
        <div class="form-group">
            <label>Message shown to visitors during maintenance</label>
            <textarea name="maintenance_message" class="form-control" rows="4"><?= e($maintMsg) ?></textarea>
        </div>
        <button type="submit" class="btn btn-primary">Save Message</button>
    </form>
</div>

<div class="card" style="max-width:640px">
    <div class="card-title">Terminal Commands</div>
    <p style="color:var(--text-muted);margin-bottom:12px">
        You can also control maintenance mode from your Ubuntu terminal:
    </p>
    <pre style="background:var(--bg3);padding:16px;border-radius:var(--radius);overflow-x:auto;font-size:.85rem;line-height:1.7"><code># Enable maintenance mode
bash /var/www/cipher-music/scripts/maintenance.sh enable

# Disable maintenance mode
bash /var/www/cipher-music/scripts/maintenance.sh disable

# Check maintenance status
bash /var/www/cipher-music/scripts/maintenance.sh status

# Note: The flag file location defaults to:
#   /var/www/cipher-music/php/maintenance.flag
# Override with: FLAG_FILE=/custom/path bash maintenance.sh enable</code></pre>
</div>

<?php adminFooter(); ?>
