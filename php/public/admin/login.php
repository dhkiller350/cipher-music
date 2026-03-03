<?php
/**
 * Admin login page
 */

require_once __DIR__ . '/../../includes/auth.php';

startSecureSession();

// Already logged in → dashboard
if (isAdminLoggedIn()) {
    header('Location: /admin/');
    exit;
}

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!verifyCsrf($_POST['csrf_token'] ?? '')) {
        $error = 'Invalid request. Please try again.';
    } else {
        $username = trim($_POST['username'] ?? '');
        $password = $_POST['password'] ?? '';

        if ($username === '' || $password === '') {
            $error = 'Please enter your username and password.';
        } elseif (adminLogin($username, $password)) {
            header('Location: /admin/');
            exit;
        } else {
            // Small delay to slow brute-force
            sleep(1);
            $error = 'Invalid username or password.';
        }
    }
}

$siteName = SITE_NAME;
$clientIP = getClientIP();
$displayIP = (ipVersion($clientIP) === 6) ? formatIPv6($clientIP) : normalizeIPv4ToIPv6($clientIP);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#0f0f1a">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>Admin Login — <?= e($siteName) ?></title>
    <link rel="stylesheet" href="/assets/css/style.css">
    <style>
        body { display:flex; align-items:center; justify-content:center; min-height:100vh; }
        .login-box { width:100%; max-width:380px; padding:0 16px; }
        .login-box .brand { text-align:center; font-size:1.5rem; font-weight:700; color:var(--accent); margin-bottom:24px; }
    </style>
</head>
<body>
<div class="login-box">
    <div class="brand">🎵 <?= e($siteName) ?> Admin</div>
    <div class="card">
        <?php if ($error): ?>
            <div class="alert alert-danger" data-auto-dismiss><?= e($error) ?></div>
        <?php endif; ?>

        <form method="POST" action="/admin/login.php" autocomplete="on">
            <?= csrfField() ?>
            <div class="form-group">
                <label for="username">Username</label>
                <input type="text" id="username" name="username" class="form-control"
                       autocomplete="username" required autofocus
                       value="<?= e($_POST['username'] ?? '') ?>">
            </div>
            <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" class="form-control"
                       autocomplete="current-password" required>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">Sign In</button>
        </form>
    </div>
    <p style="text-align:center;font-size:.8rem;color:var(--text-muted);margin-top:12px;">
        Your IP: <span class="ip-v6"><?= e($displayIP) ?></span>
    </p>
</div>
<script src="/assets/js/app.js"></script>
</body>
</html>
