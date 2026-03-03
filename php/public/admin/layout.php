<?php
/**
 * Shared admin layout helper — included at the top of every admin page.
 *
 * Provides: requireAdmin(), $siteName, $adminUser, isMaintenanceMode(),
 * and the HTML <head> + sidebar opening tags.
 *
 * The calling page must close </div><!-- /main-content --> </div><!-- /layout -->
 * and call adminFooter().
 *
 * Usage:
 *   require_once __DIR__ . '/layout.php';
 *   adminHeader('Page Title', 'nav-key');
 *   // ... page content ...
 *   adminFooter();
 */

require_once __DIR__ . '/../../includes/auth.php';
require_once __DIR__ . '/../../includes/functions.php';

function adminHeader(string $pageTitle, string $activeNav = ''): void {
    requireAdmin();
    $siteName  = SITE_NAME;
    $adminUser = $_SESSION['admin_username'] ?? 'Admin';
    $maint     = isMaintenanceMode();
    ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#0f0f1a">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title><?= e($pageTitle) ?> — <?= e($siteName) ?> Admin</title>
    <link rel="stylesheet" href="/assets/css/style.css">
    <link rel="stylesheet" href="/assets/css/admin.css">
</head>
<body>
<?php if ($maint): ?>
<div class="maintenance-banner">⚠️ Maintenance Mode is ACTIVE — the site is hidden from visitors</div>
<?php endif; ?>

<nav class="navbar">
    <div class="container inner">
        <span class="brand">🎵 <?= e($siteName) ?> Admin</span>
        <nav>
            <span style="color:var(--text-muted);font-size:.85rem;">👤 <?= e($adminUser) ?></span>
            &nbsp;
            <a href="/admin/maintenance.php" class="btn btn-sm <?= $maint ? 'btn-warning' : 'btn-success' ?>"
               style="font-size:.78rem">
                <?= $maint ? '🔧 Maintenance ON' : '✅ Site Live' ?>
            </a>
            &nbsp;
            <a href="/admin/logout.php" class="btn btn-sm btn-danger" style="font-size:.78rem">Logout</a>
        </nav>
    </div>
</nav>

<div class="layout">
<aside class="sidebar">
    <a href="/admin/" class="<?= $activeNav === 'dashboard' ? 'active' : '' ?>">📊 Dashboard</a>
    <a href="/admin/users.php" class="<?= $activeNav === 'users' ? 'active' : '' ?>">👥 Users</a>
    <a href="/admin/payments.php" class="<?= $activeNav === 'payments' ? 'active' : '' ?>">💳 Payments</a>
    <a href="/admin/logs.php" class="<?= $activeNav === 'logs' ? 'active' : '' ?>">📋 Access Logs</a>
    <div class="sep"></div>
    <a href="/admin/maintenance.php" class="<?= $activeNav === 'maintenance' ? 'active' : '' ?>">🔧 Maintenance</a>
    <a href="/" target="_blank">🌐 View Site</a>
</aside>
<main class="main-content">
    <?php
}

function adminFooter(): void {
    ?>
</main>
</div><!-- /.layout -->
<script src="/assets/js/app.js"></script>
</body>
</html>
    <?php
}
