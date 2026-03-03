<?php
/**
 * Public home page — serves the front-end landing page.
 * If maintenance mode is active, redirects non-admin visitors to the
 * maintenance page.
 */

require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/auth.php';

startSecureSession();
logAccess(isset($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : null);

// Maintenance mode gate
if (isMaintenanceMode() && !isAdminLoggedIn()) {
    include __DIR__ . '/maintenance.php';
    exit;
}

$siteName = SITE_NAME;
$clientIP = getClientIP();
$ipVer    = ipVersion($clientIP);
$displayIP = ($ipVer === 6) ? formatIPv6($clientIP) : normalizeIPv4ToIPv6($clientIP);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#0f0f1a">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title><?= e($siteName) ?></title>
    <link rel="stylesheet" href="/assets/css/style.css">
</head>
<body>
<nav class="navbar">
    <div class="container inner">
        <span class="brand">🎵 <?= e($siteName) ?></span>
        <nav>
            <a href="/" class="active">Home</a>
            <a href="/admin/">Admin Panel</a>
        </nav>
    </div>
</nav>

<div class="container" style="padding-top:60px; text-align:center;">
    <h1 style="font-size:2.5rem; color:var(--accent); margin-bottom:12px;">Welcome to <?= e($siteName) ?></h1>
    <p style="color:var(--text-muted); max-width:500px; margin:0 auto 32px;">
        Stream, share, and manage your music library.
    </p>

    <div class="card" style="max-width:480px; margin:0 auto; text-align:left;">
        <div class="card-title">Your Connection</div>
        <table style="width:100%">
            <tr>
                <td style="color:var(--text-muted); width:120px;">IP Address</td>
                <td class="ip-v6"><?= e($displayIP) ?></td>
            </tr>
            <tr>
                <td style="color:var(--text-muted);">IP Version</td>
                <td>IPv<?= e((string)$ipVer) ?></td>
            </tr>
        </table>
    </div>

    <a href="/admin/" class="btn btn-primary" style="margin-top:20px;">Go to Admin Panel</a>
</div>

<script src="/assets/js/app.js"></script>
</body>
</html>
