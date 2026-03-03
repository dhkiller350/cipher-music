#!/usr/bin/env bash
# =============================================================================
# Cipher Music — Maintenance Mode Toggle Script
# Usage: bash maintenance.sh {enable|disable|status}
#
# This script creates/removes the maintenance.flag file which Nginx and PHP
# both check to determine whether maintenance mode is active.
# Run from your Ubuntu terminal as the web server user or root.
# =============================================================================

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/cipher-music}"
FLAG_FILE="${FLAG_FILE:-${APP_DIR}/php/maintenance.flag}"

usage() {
    echo "Usage: $0 {enable|disable|status}"
    echo ""
    echo "  enable   — activate maintenance mode (visitors see 503)"
    echo "  disable  — deactivate maintenance mode (site goes live)"
    echo "  status   — show current maintenance mode status"
    exit 1
}

cmd="${1:-}"
case "$cmd" in
    enable)
        echo "$(date '+%Y-%m-%d %H:%M:%S %Z')" > "$FLAG_FILE"
        echo "✅ Maintenance mode ENABLED."
        echo "   Flag file: $FLAG_FILE"
        echo "   Reload Nginx for the change to take immediate effect:"
        echo "   sudo nginx -s reload"
        ;;
    disable)
        if [ -f "$FLAG_FILE" ]; then
            rm -f "$FLAG_FILE"
            echo "✅ Maintenance mode DISABLED. Site is now LIVE."
        else
            echo "ℹ️  Maintenance mode was already disabled."
        fi
        ;;
    status)
        if [ -f "$FLAG_FILE" ]; then
            SINCE=$(cat "$FLAG_FILE")
            echo "🔧 Maintenance mode is ACTIVE  (since: $SINCE)"
        else
            echo "✅ Maintenance mode is INACTIVE — site is LIVE."
        fi
        ;;
    *)
        usage
        ;;
esac
