<?php
/**
 * Cipher Music — Terminal Admin CLI
 *
 * Run from your VSCode / Ubuntu terminal to manage the app remotely.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   php admin/admin.php <command> [args...]
 *
 * COMMANDS
 *   status                       Show maintenance state + quick stats
 *   maintenance on|off           Toggle maintenance mode (affects ALL devices)
 *
 *   logs [--limit=N]             Show recent login/signup events
 *   payments [--limit=N]         Show all payments (pending / confirmed / revoked)
 *   users [--limit=N]            List registered users
 *
 *   ban   <email>                Ban & remove a user account
 *   unban <email>                Remove email from ban list
 *   bans                         List all banned emails
 *
 *   revoke  <payment-ref>        Revoke a payment (sets status=revoked)
 *   confirm <payment-ref>        Confirm a pending payment (sets status=confirmed)
 *
 *   watch [--interval=N]         Live tail — prints new payments & access events as they arrive
 *                                (default poll interval: 3 seconds, Ctrl+C to stop)
 *
 *   clear-logs                   Clear the access log
 *
 * EXAMPLES
 *   php admin/admin.php status
 *   php admin/admin.php maintenance on
 *   php admin/admin.php logs --limit=20
 *   php admin/admin.php payments
 *   php admin/admin.php confirm PAY-ABCD1234
 *   php admin/admin.php revoke  PAY-ABCD1234
 *   php admin/admin.php ban user@example.com
 *   php admin/admin.php watch
 *
 * TIP — run on a remote server over SSH:
 *   ssh user@yourserver "php /var/www/cipher-music/admin/admin.php status"
 *   ssh user@yourserver "php /var/www/cipher-music/admin/admin.php watch"
 * ─────────────────────────────────────────────────────────────────────────────
 */

// CLI only — refuse browser/web-server requests
if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'CLI only']);
    exit(1);
}

// ── File paths ────────────────────────────────────────────────────────────────
define('DATA_DIR',        __DIR__ . '/data');
define('STATUS_FILE',     DATA_DIR . '/status.json');
define('PAYMENTS_FILE',   DATA_DIR . '/payments.json');
define('USERS_FILE',      DATA_DIR . '/users.json');
define('BANNED_FILE',     DATA_DIR . '/banned.json');
define('ACCESS_LOG_FILE', DATA_DIR . '/access_log.json');

// ── Helpers ───────────────────────────────────────────────────────────────────
function read_json(string $file, $default = []) {
    if (!file_exists($file)) return $default;
    return json_decode(file_get_contents($file) ?: '', true) ?: $default;
}

function write_json(string $file, $data): void {
    $dir = dirname($file);
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function hr(string $char = '─', int $width = 65): void {
    echo str_repeat($char, $width) . "\n";
}

function fmt_ts(int $ts): string {
    return $ts ? date('Y-m-d H:i:s', $ts) : '—';
}

function parse_limit(array $argv, int $default = 50): int {
    foreach ($argv as $arg) {
        if (preg_match('/^--limit=(\d+)$/', $arg, $m)) return (int)$m[1];
    }
    return $default;
}

function parse_interval(array $argv, int $default = 3): int {
    foreach ($argv as $arg) {
        if (preg_match('/^--interval=(\d+)$/', $arg, $m)) return max(1, (int)$m[1]);
    }
    return $default;
}


$cmd = strtolower(trim($argv[1] ?? ''));
$arg = trim($argv[2] ?? '');

if (!$cmd || $cmd === 'help' || $cmd === '--help' || $cmd === '-h') {
    // Print the usage block from the docblock at top of file
    $lines = file(__FILE__);
    $in = false;
    foreach ($lines as $line) {
        if (!$in && strpos($line, 'USAGE') !== false) { $in = true; }
        if ($in) { echo ltrim($line, ' *'); }
        if ($in && strpos($line, 'TIP —') !== false) break;
    }
    exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// status
// ─────────────────────────────────────────────────────────────────────────────
if ($cmd === 'status') {
    $state    = read_json(STATUS_FILE, ['maintenance' => false, 'ts' => 0]);
    $payments = read_json(PAYMENTS_FILE, []);
    $users    = read_json(USERS_FILE, []);
    $banned   = read_json(BANNED_FILE, []);
    $logs     = read_json(ACCESS_LOG_FILE, []);
    $pending  = count(array_filter($payments, fn($p) => ($p['status'] ?? '') === 'pending'));
    $on       = (bool)($state['maintenance'] ?? false);
    $ts       = fmt_ts((int)($state['ts'] ?? 0));
    hr('═');
    echo "  Cipher Music — Admin Status\n";
    hr('═');
    echo "  Maintenance mode  : " . ($on ? "ON  🔴" : "OFF 🟢") . "\n";
    echo "  Last changed      : $ts\n";
    hr();
    echo "  Registered users  : " . count($users)    . "\n";
    echo "  Banned accounts   : " . count($banned)   . "\n";
    echo "  Total payments    : " . count($payments) . "\n";
    echo "  Pending payments  : $pending\n";
    echo "  Access log entries: " . count($logs)     . "\n";
    hr('═');
    echo "  Terminal commands:\n";
    echo "    php admin/admin.php maintenance on|off\n";
    echo "    php admin/admin.php logs       [--limit=N]\n";
    echo "    php admin/admin.php payments   [--limit=N]\n";
    echo "    php admin/admin.php users      [--limit=N]\n";
    echo "    php admin/admin.php ban   <email>\n";
    echo "    php admin/admin.php revoke <payment-ref>\n";
    echo "    php admin/admin.php confirm <payment-ref>\n";
    hr('═');
    exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// maintenance on | off
// ─────────────────────────────────────────────────────────────────────────────
if ($cmd === 'maintenance') {
    if (!in_array($arg, ['on', 'off'], true)) {
        fwrite(STDERR, "Usage: php admin/admin.php maintenance on|off\n");
        exit(1);
    }
    $enable = ($arg === 'on');
    $state  = read_json(STATUS_FILE, ['maintenance' => false, 'ts' => 0, 'log' => []]);
    $state['maintenance'] = $enable;
    $state['ts']          = time();
    if (!isset($state['log'])) $state['log'] = [];
    $state['log'][] = ['ts' => date('c'), 'msg' => 'Maintenance ' . ($enable ? 'enabled' : 'disabled') . ' via admin CLI', 'ok' => true];
    if (count($state['log']) > 500) $state['log'] = array_slice($state['log'], -500);
    write_json(STATUS_FILE, $state);
    $icon = $enable ? '🔴' : '🟢';
    echo "✅ Maintenance mode " . ($enable ? "ENABLED $icon" : "DISABLED $icon") . "\n";
    echo "   All connected devices will update within ~15 seconds.\n";
    // Terminal log
    error_log("[Cipher] MAINTENANCE " . strtoupper($arg) . " via CLI at " . date('c'));
    exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// logs [--limit=N]
// ─────────────────────────────────────────────────────────────────────────────
if ($cmd === 'logs') {
    $limit   = parse_limit($argv);
    $entries = read_json(ACCESS_LOG_FILE, []);
    $entries = array_reverse($entries);
    $entries = array_slice($entries, 0, $limit);
    $total   = count(read_json(ACCESS_LOG_FILE, []));
    hr('═');
    echo "  Access Log  (newest first, showing " . count($entries) . " of $total)\n";
    hr('═');
    printf("  %-8s %-28s %-20s %-16s %s\n", 'EVENT', 'TIME', 'EMAIL', 'USERNAME', 'IP');
    hr();
    foreach ($entries as $e) {
        $ev  = strtoupper($e['event']    ?? '?');
        $t   = $e['logged_at'] ?? fmt_ts((int)(($e['ts'] ?? 0) / 1000));
        $em  = $e['email']    ?? '—';
        $usr = $e['username'] ?? '—';
        $ip  = $e['ip']       ?? '—';
        printf("  %-8s %-28s %-20s %-16s %s\n", $ev, $t, $em, $usr, $ip);
    }
    hr('═');
    exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// payments [--limit=N]
// ─────────────────────────────────────────────────────────────────────────────
if ($cmd === 'payments') {
    $limit    = parse_limit($argv);
    $payments = read_json(PAYMENTS_FILE, []);
    $payments = array_reverse($payments);
    $payments = array_slice($payments, 0, $limit);
    $total    = count(read_json(PAYMENTS_FILE, []));
    hr('═');
    echo "  Payments  (newest first, showing " . count($payments) . " of $total)\n";
    hr('═');
    printf("  %-20s %-10s %-8s %-24s %s\n", 'REF', 'PLAN', 'STATUS', 'EMAIL', 'RECEIVED');
    hr();
    foreach ($payments as $p) {
        $ref  = $p['ref']         ?? '—';
        $plan = strtoupper($p['plan']   ?? '—');
        $stat = strtoupper($p['status'] ?? '—');
        $em   = $p['email']       ?? '—';
        $recv = $p['received_at'] ?? '—';
        printf("  %-20s %-10s %-8s %-24s %s\n", $ref, $plan, $stat, $em, $recv);
    }
    hr('═');
    echo "  To confirm: php admin/admin.php confirm <REF>\n";
    echo "  To revoke : php admin/admin.php revoke  <REF>\n";
    hr('═');
    exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// users [--limit=N]
// ─────────────────────────────────────────────────────────────────────────────
if ($cmd === 'users') {
    $limit = parse_limit($argv);
    $users = read_json(USERS_FILE, []);
    $users = array_reverse($users);
    $users = array_slice($users, 0, $limit);
    $total = count(read_json(USERS_FILE, []));
    $banned = read_json(BANNED_FILE, []);
    hr('═');
    echo "  Users  (newest first, showing " . count($users) . " of $total)\n";
    hr('═');
    printf("  %-24s %-20s %-24s %s\n", 'EMAIL', 'USERNAME', 'MEMBER SINCE', 'BANNED');
    hr();
    foreach ($users as $u) {
        $em   = $u['email']       ?? '—';
        $usr  = $u['username']    ?? '—';
        $sinc = $u['memberSince'] ?? $u['registeredAt'] ?? '—';
        $ban  = in_array(strtolower($em), array_map('strtolower', $banned), true) ? '🚫 YES' : '';
        printf("  %-24s %-20s %-24s %s\n", $em, $usr, $sinc, $ban);
    }
    hr('═');
    echo "  To ban: php admin/admin.php ban <email>\n";
    hr('═');
    exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// ban <email>
// ─────────────────────────────────────────────────────────────────────────────
if ($cmd === 'ban') {
    $email = strtolower(trim($arg));
    if (!$email) { fwrite(STDERR, "Usage: php admin/admin.php ban <email>\n"); exit(1); }

    // Remove from users
    $users = read_json(USERS_FILE, []);
    $before = count($users);
    $users = array_values(array_filter($users, fn($u) => strtolower($u['email'] ?? '') !== $email));
    write_json(USERS_FILE, $users);

    // Add to banned list
    $banned = read_json(BANNED_FILE, []);
    if (!in_array($email, $banned, true)) {
        $banned[] = $email;
        write_json(BANNED_FILE, $banned);
    }

    $removed = $before - count($users);
    echo "🚫 Banned: $email\n";
    echo "   Removed $removed user record(s).\n";
    error_log("[Cipher] BAN | email={$email} via CLI at " . date('c'));
    exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// unban <email>
// ─────────────────────────────────────────────────────────────────────────────
if ($cmd === 'unban') {
    $email = strtolower(trim($arg));
    if (!$email) { fwrite(STDERR, "Usage: php admin/admin.php unban <email>\n"); exit(1); }
    $banned = read_json(BANNED_FILE, []);
    $banned = array_values(array_filter($banned, fn($e) => $e !== $email));
    write_json(BANNED_FILE, $banned);
    echo "✅ Unbanned: $email\n";
    error_log("[Cipher] UNBAN | email={$email} via CLI at " . date('c'));
    exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// bans
// ─────────────────────────────────────────────────────────────────────────────
if ($cmd === 'bans') {
    $banned = read_json(BANNED_FILE, []);
    hr('═');
    echo "  Banned accounts (" . count($banned) . ")\n";
    hr('═');
    if (empty($banned)) { echo "  (none)\n"; } else {
        foreach ($banned as $e) echo "  🚫 $e\n";
    }
    hr('═');
    exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// revoke <ref>
// ─────────────────────────────────────────────────────────────────────────────
if ($cmd === 'revoke') {
    $ref = strtoupper(trim($arg));
    if (!$ref) { fwrite(STDERR, "Usage: php admin/admin.php revoke <payment-ref>\n"); exit(1); }
    $payments = read_json(PAYMENTS_FILE, []);
    $found = false;
    foreach ($payments as &$p) {
        if (($p['ref'] ?? '') === $ref) {
            $p['status']     = 'revoked';
            $p['revoked_at'] = date('c');
            $found = true;
            break;
        }
    }
    unset($p);
    if (!$found) { fwrite(STDERR, "❌ Payment ref not found: $ref\n"); exit(1); }
    write_json(PAYMENTS_FILE, $payments);
    echo "🚫 Payment $ref revoked.\n";
    error_log("[Cipher] REVOKE | ref={$ref} via CLI at " . date('c'));
    exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// confirm <ref>
// ─────────────────────────────────────────────────────────────────────────────
if ($cmd === 'confirm') {
    $ref = strtoupper(trim($arg));
    if (!$ref) { fwrite(STDERR, "Usage: php admin/admin.php confirm <payment-ref>\n"); exit(1); }
    $payments = read_json(PAYMENTS_FILE, []);
    $found = false;
    foreach ($payments as &$p) {
        if (($p['ref'] ?? '') === $ref) {
            $p['status']       = 'confirmed';
            $p['confirmed_at'] = date('c');
            $found = true;
            break;
        }
    }
    unset($p);
    if (!$found) { fwrite(STDERR, "❌ Payment ref not found: $ref\n"); exit(1); }
    write_json(PAYMENTS_FILE, $payments);
    echo "✅ Payment $ref confirmed.\n";
    error_log("[Cipher] CONFIRM | ref={$ref} via CLI at " . date('c'));
    exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// clear-logs
// ─────────────────────────────────────────────────────────────────────────────
if ($cmd === 'clear-logs') {
    write_json(ACCESS_LOG_FILE, []);
    echo "✅ Access log cleared.\n";
    error_log("[Cipher] CLEAR-LOGS via CLI at " . date('c'));
    exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// watch [--interval=N]
// Live tail — prints new payments and access-log events as they arrive.
// ─────────────────────────────────────────────────────────────────────────────
if ($cmd === 'watch') {
    $interval = parse_interval($argv);
    hr('═');
    echo "  👁  Cipher Music — Live Monitor  (Ctrl+C to stop, polling every {$interval}s)\n";
    hr('═');

    // Seed seen-set with whatever already exists so we only print NEW items.
    $seenPayments = [];
    foreach (read_json(PAYMENTS_FILE, []) as $p) {
        $seenPayments[$p['ref'] ?? ''] = true;
    }
    $seenLogs = [];
    foreach (read_json(ACCESS_LOG_FILE, []) as $l) {
        $seenLogs[($l['email'] ?? '') . ($l['ts'] ?? '') . ($l['event'] ?? '')] = true;
    }

    while (true) {
        // ── new payments ──────────────────────────────────────────────────────
        foreach (read_json(PAYMENTS_FILE, []) as $p) {
            $ref = $p['ref'] ?? '';
            if ($ref && !isset($seenPayments[$ref])) {
                $seenPayments[$ref] = true;
                $stat = strtoupper($p['status'] ?? 'PENDING');
                $plan = strtoupper($p['plan']   ?? '?');
                $em   = $p['email']       ?? '—';
                $recv = $p['received_at'] ?? date('c');
                $icon = $stat === 'CONFIRMED' ? '✅' : ($stat === 'REVOKED' ? '🚫' : '💰');
                echo "$icon  NEW PAYMENT  [$stat]  $plan  $em  ref=$ref  $recv\n";
                echo "   → confirm: php admin/admin.php confirm $ref\n";
                echo "   → revoke : php admin/admin.php revoke  $ref\n";
            }
        }

        // ── new access-log events ─────────────────────────────────────────────
        foreach (read_json(ACCESS_LOG_FILE, []) as $l) {
            $key = ($l['email'] ?? '') . ($l['ts'] ?? '') . ($l['event'] ?? '');
            if ($key && !isset($seenLogs[$key])) {
                $seenLogs[$key] = true;
                $ev  = strtoupper($l['event'] ?? '?');
                $em  = $l['email']    ?? '—';
                $usr = $l['username'] ?? '—';
                $ip  = $l['ip']       ?? '—';
                $t   = $l['logged_at'] ?? date('c');
                $icon = match($ev) { 'SIGNUP' => '🆕', 'LOGIN' => '🔓', 'LOGOUT' => '🔒', default => '📋' };
                echo "$icon  $ev  $em  username=$usr  ip=$ip  $t\n";
                if ($ev === 'SIGNUP') {
                    echo "   → ban: php admin/admin.php ban $em\n";
                }
            }
        }

        sleep($interval);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unknown command
// ─────────────────────────────────────────────────────────────────────────────
fwrite(STDERR, "Unknown command: $cmd\nRun: php admin/admin.php help\n");
exit(1);
