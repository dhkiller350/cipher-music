<?php
/**
 * Cipher Music — Maintenance Mode CLI Tool
 *
 * Run this script from your Ubuntu terminal to toggle maintenance
 * mode on or off without opening a browser.
 *
 * Usage:
 *   php admin/maintenance.php on      # enable maintenance mode
 *   php admin/maintenance.php off     # disable maintenance mode
 *   php admin/maintenance.php status  # check current state
 *
 * The script toggles maintenance mode via two mechanisms:
 *   1. admin/data/status.json  — read by the PHP app and admin panel
 *   2. /var/www/cipher-music/.maintenance (nginx flag file)
 *      — read by nginx to return 503 for non-admin traffic
 *      — only touched when --nginx flag is passed (requires sudo)
 *
 * Examples:
 *   php admin/maintenance.php on
 *   php admin/maintenance.php off
 *   php admin/maintenance.php on  --nginx    # also create nginx flag file
 *   php admin/maintenance.php off --nginx    # also remove nginx flag file
 *
 * Remote use (SSH from your terminal):
 *   ssh user@yourserver "php /var/www/cipher-music/admin/maintenance.php on"
 */

// ── Must run from CLI only ─────────────────────────────────────────────────────
if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'CLI only']);
    exit(1);
}

// ── Parse arguments ────────────────────────────────────────────────────────────
$cmd       = strtolower(trim($argv[1] ?? ''));
$useNginx  = in_array('--nginx', array_slice($argv, 2), true);

if (!in_array($cmd, ['on', 'off', 'status'])) {
    fwrite(STDERR, "Usage: php maintenance.php <on|off|status> [--nginx]\n");
    exit(1);
}

// ── Files ──────────────────────────────────────────────────────────────────────
$statusFile = __DIR__ . '/data/status.json';
$nginxFlag  = '/var/www/cipher-music/.maintenance';

// ── Helper: load/save status.json ─────────────────────────────────────────────
function load_state(string $file): array {
    if (!file_exists($file)) return ['maintenance' => false, 'ts' => 0, 'log' => []];
    return json_decode(file_get_contents($file) ?: '{}', true)
        ?: ['maintenance' => false, 'ts' => 0, 'log' => []];
}

function save_state(string $file, array $state): void {
    $dir = dirname($file);
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    file_put_contents($file, json_encode($state, JSON_PRETTY_PRINT));
}

// ── Status check ──────────────────────────────────────────────────────────────
if ($cmd === 'status') {
    $state  = load_state($statusFile);
    $on     = (bool)($state['maintenance'] ?? false);
    $nginx  = file_exists($nginxFlag);
    $ts     = $state['ts'] ? date('Y-m-d H:i:s T', (int)$state['ts']) : 'never';
    echo "──────────────────────────────\n";
    echo " Maintenance mode : " . ($on ? "ON  🔴" : "OFF 🟢") . "\n";
    echo " Last changed     : $ts\n";
    echo " Nginx flag file  : " . ($nginx ? "present ($nginxFlag)" : "absent") . "\n";
    echo "──────────────────────────────\n";
    exit(0);
}

// ── Toggle ────────────────────────────────────────────────────────────────────
$enable = ($cmd === 'on');
$state  = load_state($statusFile);

$state['maintenance'] = $enable;
$state['ts']          = time();
if (!isset($state['log'])) $state['log'] = [];
$state['log'][] = [
    'ts'  => date('c'),
    'msg' => 'Maintenance ' . ($enable ? 'enabled' : 'disabled') . ' via CLI',
    'ok'  => true,
];
// Keep last 500 log entries
if (count($state['log']) > 500) {
    $state['log'] = array_slice($state['log'], -500);
}
save_state($statusFile, $state);

echo "✅ Maintenance mode " . ($enable ? "ENABLED" : "DISABLED") . " in status.json\n";

// ── Optional nginx flag file ───────────────────────────────────────────────────
if ($useNginx) {
    if ($enable) {
        if (touch($nginxFlag)) {
            echo "✅ Nginx flag file created: $nginxFlag\n";
            echo "   → Run: sudo systemctl reload nginx   (if not auto-reloaded)\n";
        } else {
            fwrite(STDERR, "⚠  Could not create $nginxFlag (try with sudo)\n");
        }
    } else {
        if (file_exists($nginxFlag)) {
            if (unlink($nginxFlag)) {
                echo "✅ Nginx flag file removed: $nginxFlag\n";
            } else {
                fwrite(STDERR, "⚠  Could not remove $nginxFlag (try with sudo)\n");
            }
        } else {
            echo "ℹ  Nginx flag file was already absent.\n";
        }
    }
}

echo "\nDone. Admin panel status visible at: /admin/index.php\n";
