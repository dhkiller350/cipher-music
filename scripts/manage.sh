#!/usr/bin/env bash
# =============================================================================
# Cipher Music — Remote Management CLI
# Requires: curl  (sudo apt install curl)
#
# Usage:
#   export API_URL="http://YOUR_SERVER/api"
#   export API_SECRET="your_secret_key"
#   bash manage.sh <command> [args]
#
# Commands:
#   users list [--status active|banned|deleted] [--search QUERY]
#   users get <ID>
#   users ban <ID> [--reason "REASON"]
#   users unban <ID>
#   users delete <ID>
#
#   payments list [--status pending|completed|revoked|refunded|deleted]
#   payments get <ID>
#   payments revoke <ID> [--reason "REASON"]
#   payments delete <ID>
#
#   maintenance status
#   maintenance enable
#   maintenance disable
#
#   logs list [--ip FILTER]
# =============================================================================

set -euo pipefail

API_URL="${API_URL:-http://localhost/api}"
API_SECRET="${API_SECRET:-}"

if [ -z "$API_SECRET" ]; then
    echo "❌ ERROR: API_SECRET environment variable is not set."
    echo "   export API_SECRET='your_api_secret'"
    exit 1
fi

_curl() {
    curl -s -H "Authorization: Bearer ${API_SECRET}" \
         -H "Content-Type: application/json" \
         -H "Accept: application/json" \
         "$@"
}

_pretty() {
    # Pretty-print JSON if python3 or jq is available
    if command -v jq &>/dev/null; then
        jq .
    elif command -v python3 &>/dev/null; then
        python3 -m json.tool
    else
        cat
    fi
}

# URL-encode a string (percent-encode non-safe characters)
_urlencode() {
    python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=''))" "$1" 2>/dev/null \
        || printf '%s' "$1" | sed 's/ /%20/g;s/&/%26/g;s/=/%3D/g;s/+/%2B/g'
}

resource="${1:-}"
action="${2:-}"
shift 2 2>/dev/null || true

# Parse optional flags
ARG_ID=""
ARG_REASON=""
ARG_STATUS=""
ARG_SEARCH=""
ARG_IP=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --reason)  ARG_REASON="$2"; shift 2 ;;
        --status)  ARG_STATUS="$2"; shift 2 ;;
        --search)  ARG_SEARCH="$2"; shift 2 ;;
        --ip)      ARG_IP="$2"; shift 2 ;;
        *)         ARG_ID="$1"; shift ;;
    esac
done

# ── Users ─────────────────────────────────────────────────────────────────────
if [ "$resource" = "users" ]; then
    case "$action" in
        list)
            QS="?"
            [ -n "$ARG_STATUS" ] && QS="${QS}status=$(_urlencode "$ARG_STATUS")&"
            [ -n "$ARG_SEARCH" ] && QS="${QS}q=$(_urlencode "$ARG_SEARCH")&"
            _curl "${API_URL}/users${QS}" | _pretty
            ;;
        get)
            _curl "${API_URL}/users/${ARG_ID}" | _pretty
            ;;
        ban)
            BODY=$(printf '{"reason":"%s"}' "${ARG_REASON:-Banned via CLI}")
            _curl -X POST "${API_URL}/users/${ARG_ID}/ban" -d "$BODY" | _pretty
            ;;
        unban)
            _curl -X POST "${API_URL}/users/${ARG_ID}/unban" | _pretty
            ;;
        delete)
            _curl -X DELETE "${API_URL}/users/${ARG_ID}" | _pretty
            ;;
        *)
            echo "Unknown users action: $action"; exit 1 ;;
    esac

# ── Payments ──────────────────────────────────────────────────────────────────
elif [ "$resource" = "payments" ]; then
    case "$action" in
        list)
            QS="?"
            [ -n "$ARG_STATUS" ] && QS="${QS}status=$(_urlencode "$ARG_STATUS")&"
            [ -n "$ARG_SEARCH" ] && QS="${QS}q=$(_urlencode "$ARG_SEARCH")&"
            _curl "${API_URL}/payments${QS}" | _pretty
            ;;
        get)
            _curl "${API_URL}/payments/${ARG_ID}" | _pretty
            ;;
        revoke)
            BODY=$(printf '{"reason":"%s"}' "${ARG_REASON:-Revoked via CLI}")
            _curl -X POST "${API_URL}/payments/${ARG_ID}/revoke" -d "$BODY" | _pretty
            ;;
        delete)
            _curl -X DELETE "${API_URL}/payments/${ARG_ID}" | _pretty
            ;;
        *)
            echo "Unknown payments action: $action"; exit 1 ;;
    esac

# ── Maintenance ───────────────────────────────────────────────────────────────
elif [ "$resource" = "maintenance" ]; then
    case "$action" in
        status)  _curl "${API_URL}/maintenance" | _pretty ;;
        enable)  _curl -X POST "${API_URL}/maintenance/enable"  | _pretty ;;
        disable) _curl -X POST "${API_URL}/maintenance/disable" | _pretty ;;
        *)       echo "Unknown maintenance action: $action"; exit 1 ;;
    esac

# ── Logs ──────────────────────────────────────────────────────────────────────
elif [ "$resource" = "logs" ]; then
    case "$action" in
        list)
            QS="?"
            [ -n "$ARG_IP" ] && QS="${QS}ip=$(_urlencode "$ARG_IP")&"
            _curl "${API_URL}/logs${QS}" | _pretty
            ;;
        *)
            echo "Unknown logs action: $action"; exit 1 ;;
    esac

else
    echo "Cipher Music — Remote Management CLI"
    echo ""
    echo "Usage: API_URL=http://YOUR_SERVER/api API_SECRET=xxx bash manage.sh <resource> <action> [options]"
    echo ""
    echo "Resources: users, payments, maintenance, logs"
    echo ""
    echo "Examples:"
    echo "  bash manage.sh users list"
    echo "  bash manage.sh users ban 42 --reason 'Spam'"
    echo "  bash manage.sh users unban 42"
    echo "  bash manage.sh users delete 42"
    echo "  bash manage.sh payments list --status pending"
    echo "  bash manage.sh payments revoke 7 --reason 'Fraud'"
    echo "  bash manage.sh payments delete 7"
    echo "  bash manage.sh maintenance enable"
    echo "  bash manage.sh maintenance disable"
    echo "  bash manage.sh maintenance status"
    echo "  bash manage.sh logs list --ip '::ffff:10'"
    exit 1
fi
