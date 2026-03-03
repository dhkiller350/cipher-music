<?php
/**
 * Admin logout
 */
require_once __DIR__ . '/../../includes/auth.php';
startSecureSession();
adminLogout();
header('Location: /admin/login.php');
exit;
