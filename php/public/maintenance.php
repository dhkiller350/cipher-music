<?php
/**
 * Maintenance mode page — shown to non-admin users when maintenance is active.
 * This file is included by index.php and can also be served directly by Nginx.
 */

require_once __DIR__ . '/../includes/functions.php';

$siteName = SITE_NAME;
$message  = 'The site is currently undergoing scheduled maintenance. Please check back soon.';
try {
    $pdo  = getDB();
    $stmt = $pdo->prepare("SELECT value FROM settings WHERE name = 'maintenance_message'");
    $stmt->execute();
    $row  = $stmt->fetch();
    if ($row) {
        $message = $row['value'];
    }
} catch (Exception $e) { /* use default */ }

http_response_code(503);
header('Retry-After: 3600');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#0f0f1a">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>Maintenance — <?= e($siteName) ?></title>
    <link rel="stylesheet" href="/assets/css/style.css">
    <style>
        body { display:flex; align-items:center; justify-content:center; min-height:100vh; }
        .maint-box { text-align:center; max-width:500px; padding:0 16px; }
        .maint-box .icon { font-size:4rem; margin-bottom:16px; }
        .maint-box h1 { font-size:2rem; margin-bottom:12px; }
        .maint-box p { color:var(--text-muted); margin-bottom:24px; }
        .admin-link { font-size:.8rem; color:var(--text-muted); margin-top:40px; }
        .admin-link a { color:var(--text-muted); }
    </style>
</head>
<body>
<div class="maint-box">
    <div class="icon">🔧</div>
    <h1>Under Maintenance</h1>
    <p><?= e($message) ?></p>
    <div class="admin-link"><a href="/admin/login.php">Admin Login</a></div>
</div>
</body>
</html>
