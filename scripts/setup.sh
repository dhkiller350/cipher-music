#!/usr/bin/env bash
# =============================================================================
# Cipher Music — Server Setup Script
# Run once on a fresh Ubuntu 22.04 / 24.04 server.
# Usage: sudo bash setup.sh
# =============================================================================

set -euo pipefail

APP_USER="${APP_USER:-www-data}"
APP_DIR="${APP_DIR:-/var/www/cipher-music}"
DB_NAME="${DB_NAME:-cipher_music}"
DB_USER="${DB_USER:-cipher_user}"
DOMAIN="${DOMAIN:-localhost}"

# Prompt for DB password if not set
if [ -z "${DB_PASSWORD:-}" ]; then
    read -rsp "Enter MySQL password for DB user '${DB_USER}': " DB_PASSWORD
    echo
fi

if [ -z "${ADMIN_PASSWORD:-}" ]; then
    read -rsp "Enter admin panel password: " ADMIN_PASSWORD
    echo
fi

echo "==> Installing packages..."
apt-get update -qq
apt-get install -y -qq nginx php8.2-fpm php8.2-mysql php8.2-mbstring \
    php8.2-xml php8.2-curl mysql-server curl jq

echo "==> Copying application files..."
rsync -a "$(dirname "$0")/../" "$APP_DIR/" \
    --exclude '.git' --exclude 'node_modules'

echo "==> Setting permissions..."
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod -R 755 "$APP_DIR"
chmod 700 "$APP_DIR/scripts"
chmod 700 "$APP_DIR/php/config"

echo "==> Creating database..."
mysql -u root <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

mysql -u root "${DB_NAME}" < "$APP_DIR/database/schema.sql"

echo "==> Generating hashed admin password..."
HASH=$(php -r "echo password_hash('${ADMIN_PASSWORD}', PASSWORD_BCRYPT, ['cost'=>12]);")
mysql -u root "${DB_NAME}" \
    -e "UPDATE admins SET password_hash='${HASH}', email='admin@${DOMAIN}' WHERE username='admin';"

echo "==> Generating API secret..."
API_SECRET=$(openssl rand -hex 32)
echo "API_SECRET=${API_SECRET}" >> "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

echo "==> Writing PHP-FPM environment..."
PHP_POOL_CONF="/etc/php/8.2/fpm/pool.d/www.conf"
grep -qxF "env[DB_HOST] = 127.0.0.1" "$PHP_POOL_CONF" || \
cat >> "$PHP_POOL_CONF" <<EOF

; Cipher Music environment
env[DB_HOST]     = 127.0.0.1
env[DB_PORT]     = 3306
env[DB_NAME]     = ${DB_NAME}
env[DB_USER]     = ${DB_USER}
env[DB_PASSWORD] = ${DB_PASSWORD}
env[API_SECRET]  = ${API_SECRET}
env[SITE_URL]    = https://${DOMAIN}
env[MAINTENANCE_FLAG_FILE] = ${APP_DIR}/php/maintenance.flag
EOF

echo "==> Installing Nginx config..."
NGINX_CONF="/etc/nginx/sites-available/cipher-music"
cp "$APP_DIR/nginx/nginx.conf" "$NGINX_CONF"
sed -i "s/YOUR_DOMAIN/${DOMAIN}/g" "$NGINX_CONF"
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/cipher-music
rm -f /etc/nginx/sites-enabled/default

echo "==> Reloading services..."
systemctl restart php8.2-fpm
nginx -t && systemctl reload nginx

echo ""
echo "==================================================================="
echo "✅ Cipher Music is installed!"
echo ""
echo "   Site URL   : http://${DOMAIN}"
echo "   Admin Panel: http://${DOMAIN}/admin/"
echo "   Admin User : admin"
echo "   Admin Pass : (the password you entered above)"
echo ""
echo "   API Secret : ${API_SECRET}"
echo "   (also saved to ${APP_DIR}/.env)"
echo ""
echo "   To manage from terminal:"
echo "   export API_URL=http://${DOMAIN}/api"
echo "   export API_SECRET=${API_SECRET}"
echo "   bash ${APP_DIR}/scripts/manage.sh maintenance status"
echo "==================================================================="
