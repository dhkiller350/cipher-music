#!/usr/bin/env bash
# ============================================================
# Cipher Music — VS Code / Ubuntu Terminal Dev Server
# ============================================================
#
# Usage (from the repo root in VS Code terminal):
#
#   chmod +x start-server.sh
#   ./start-server.sh            # start on 127.0.0.1:8080
#   ./start-server.sh 8888       # start on a different port
#   ./start-server.sh 0.0.0.0 8080   # listen on all interfaces (LAN access)
#
# Then open in your browser:
#   http://localhost:8080
#
# Admin panel:
#   http://localhost:8080/admin/index.php
#
# Set the admin panel's "Remote Server URL" to:
#   http://localhost:8080/admin
#
# This will let the front-end app log payments, users, and
# access events to the PHP server running on your machine.
#
# Requirements:
#   • PHP ≥ 7.4 (check: php --version)
#   • On Ubuntu: sudo apt install php-cli
# ============================================================

HOST="${1:-127.0.0.1}"
PORT="${2:-8080}"

# If first arg looks like a port number (all digits), treat it as PORT
if [[ "$1" =~ ^[0-9]+$ ]]; then
    HOST="127.0.0.1"
    PORT="$1"
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Make sure the data directory is writable
DATA_DIR="$ROOT/admin/data"
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR" 2>/dev/null || true

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║     Cipher Music — Local PHP Server      ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""
echo "  Root     : $ROOT"
echo "  Address  : http://$HOST:$PORT"
echo "  Admin    : http://$HOST:$PORT/admin/index.php"
echo "  API base : http://$HOST:$PORT/admin"
echo ""
echo "  Default admin PIN : 0000"
echo "  (Set CIPHER_ADMIN_PIN_HASH env var to use a different PIN)"
echo ""
echo "  ── Log files (live-updated as users connect) ──"
echo "  Logins/Signups : $DATA_DIR/access_log.json"
echo "  Payments       : $DATA_DIR/payments.json"
echo "  Users          : $DATA_DIR/users.json"
echo "  Banned         : $DATA_DIR/banned.json"
echo "  Status         : $DATA_DIR/status.json"
echo ""
echo "  ── Terminal admin commands ────────────────────"
echo "  php admin/admin.php status                   # overview"
echo "  php admin/admin.php logs      [--limit=N]    # view logins"
echo "  php admin/admin.php payments  [--limit=N]    # view payments"
echo "  php admin/admin.php users     [--limit=N]    # list users"
echo "  php admin/admin.php ban       <email>        # ban user"
echo "  php admin/admin.php revoke    <ref>          # revoke payment"
echo "  php admin/admin.php confirm   <ref>          # confirm payment"
echo "  php admin/admin.php maintenance on|off       # toggle (all devices)"
echo ""
echo "  ── Keyboard shortcut ──────────────────────────"
echo "  Ctrl+Shift+D  →  Open admin panel (PIN: 0000)"
echo "                   If maintenance is ON it turns OFF automatically"
echo ""
echo "  In the app/admin panel, set Remote Server URL to:"
echo "    http://localhost:$PORT/admin"
echo ""
echo "  PHP server log below (logins and payments echo here in real time):"
echo "  ──────────────────────────────────────────────"
echo ""
echo "  Press Ctrl+C to stop the server."
echo ""

# Start PHP built-in server
exec php -S "$HOST:$PORT" -t "$ROOT" 2>&1
