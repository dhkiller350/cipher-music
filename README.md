# Cipher Music Server

A self-hosted PHP/Nginx server for managing users, payments, and your application — with a responsive admin panel, IPv6 support, maintenance mode, and a remote REST API.

---

## Features

| Feature | Details |
|---|---|
| **User management** | List, view, ban, unban, delete users from the admin panel or terminal |
| **Payment management** | List, view, revoke, delete payments |
| **IPv6 display** | All IP addresses are stored and displayed in IPv6 format (IPv4 addresses are mapped to `::ffff:x.x.x.x`) |
| **Maintenance mode** | Toggle via the admin panel **or** from the Ubuntu terminal; admin panel is always accessible |
| **Remote REST API** | Manage users, payments, and maintenance from any terminal with `curl` or `manage.sh` |
| **Responsive UI** | Works on all devices: desktop, mobile, iOS, iPad, Android, all modern browsers |
| **Nginx** | IPv4 + IPv6 listeners, maintenance flag, TLS-ready |
| **Security** | CSRF protection, bcrypt passwords, prepared statements, Bearer token API auth |

---

## Requirements

- Ubuntu 22.04 or 24.04
- Nginx
- PHP 8.2+ with `php-fpm`, `php-mysql`, `php-mbstring`
- MySQL 8.0+ or MariaDB 10.6+

---

## Quick Install

```bash
# Clone the repo
git clone https://github.com/dhkiller350/cipher-music-test.git /var/www/cipher-music
cd /var/www/cipher-music

# Run the setup script (as root)
sudo DOMAIN=your-domain.com bash scripts/setup.sh
```

The script will:
1. Install Nginx, PHP-FPM, MySQL
2. Create the database and tables
3. Set up the admin account with the password you choose
4. Generate a random API secret
5. Configure and reload Nginx

---

## Manual Setup

### 1. Database

```bash
mysql -u root -p
```

```sql
CREATE DATABASE cipher_music;
CREATE USER 'cipher_user'@'localhost' IDENTIFIED BY 'YOUR_PASSWORD';
GRANT ALL PRIVILEGES ON cipher_music.* TO 'cipher_user'@'localhost';
FLUSH PRIVILEGES;
```

```bash
mysql -u root cipher_music < database/schema.sql
```

### 2. Environment Variables

Set these in `/etc/php/8.2/fpm/pool.d/www.conf` (inside the `[www]` pool):

```ini
env[DB_HOST]     = 127.0.0.1
env[DB_PORT]     = 3306
env[DB_NAME]     = cipher_music
env[DB_USER]     = cipher_user
env[DB_PASSWORD] = YOUR_STRONG_PASSWORD
env[API_SECRET]  = YOUR_RANDOM_SECRET_32CHARS
env[SITE_URL]    = https://your-domain.com
```

### 3. Nginx

```bash
sudo cp nginx/nginx.conf /etc/nginx/sites-available/cipher-music
# Edit the file and replace YOUR_DOMAIN with your actual domain
sudo nano /etc/nginx/sites-available/cipher-music

sudo ln -s /etc/nginx/sites-available/cipher-music /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4. File structure

```
/var/www/cipher-music/
├── database/schema.sql       # Database schema
├── maintenance.flag          # Created when maintenance mode is active
├── nginx/nginx.conf          # Nginx config
├── php/
│   ├── config/
│   │   ├── config.php        # App configuration
│   │   └── database.php      # DB connection
│   ├── includes/
│   │   ├── auth.php          # Admin authentication
│   │   └── functions.php     # Helpers, IP utilities
│   ├── api/index.php         # REST API
│   └── public/               # Web root (Nginx points here)
│       ├── index.php
│       ├── maintenance.php
│       ├── assets/
│       ├── admin/
│       │   ├── index.php     # Dashboard
│       │   ├── users.php     # User management
│       │   ├── payments.php  # Payment management
│       │   ├── logs.php      # Access logs (IPv6)
│       │   ├── maintenance.php
│       │   ├── login.php
│       │   └── logout.php
└── scripts/
    ├── maintenance.sh        # Terminal maintenance toggle
    ├── manage.sh             # Terminal remote management CLI
    └── setup.sh              # One-time server setup
```

---

## Admin Panel

Visit `http://your-domain.com/admin/` — default credentials:

| Field | Value |
|---|---|
| Username | `admin` |
| Password | *(set during setup, or change it in the DB)* |

> **IMPORTANT:** Change the default password immediately after setup.

To update the admin password:
```bash
php -r "echo password_hash('YOUR_NEW_PASSWORD', PASSWORD_BCRYPT, ['cost'=>12]);"
# Copy the output, then:
mysql -u root cipher_music -e "UPDATE admins SET password_hash='HASH' WHERE username='admin';"
```

---

## Maintenance Mode

### From the Admin Panel

Go to **Admin → 🔧 Maintenance** and click the toggle button.

### From the Ubuntu Terminal

```bash
# Enable maintenance mode
bash /var/www/cipher-music/scripts/maintenance.sh enable

# Disable maintenance mode  
bash /var/www/cipher-music/scripts/maintenance.sh disable

# Check status
bash /var/www/cipher-music/scripts/maintenance.sh status
```

When maintenance mode is active:
- Regular visitors see a 503 maintenance page
- The **admin panel** (`/admin/`) remains fully accessible
- The **REST API** (`/api/`) remains accessible

---

## Remote REST API

### Authentication

All API requests require a Bearer token:

```
Authorization: Bearer YOUR_API_SECRET
```

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/users` | List users (`?status=active&q=search&page=1`) |
| `GET` | `/api/users/{id}` | Get user by ID |
| `POST` | `/api/users/{id}/ban` | Ban user (`{"reason":"..."}`) |
| `POST` | `/api/users/{id}/unban` | Unban user |
| `DELETE` | `/api/users/{id}` | Soft-delete user |
| `GET` | `/api/payments` | List payments |
| `GET` | `/api/payments/{id}` | Get payment by ID |
| `POST` | `/api/payments/{id}/revoke` | Revoke payment (`{"reason":"..."}`) |
| `DELETE` | `/api/payments/{id}` | Soft-delete payment |
| `GET` | `/api/maintenance` | Get maintenance status |
| `POST` | `/api/maintenance/enable` | Enable maintenance |
| `POST` | `/api/maintenance/disable` | Disable maintenance |
| `GET` | `/api/logs` | Access logs (`?ip=::ffff:&page=1`) |

### Example curl Commands

```bash
export API_URL="http://your-domain.com/api"
export API_SECRET="your_api_secret"

# List all users
curl -H "Authorization: Bearer $API_SECRET" "$API_URL/users"

# Ban a user
curl -X POST -H "Authorization: Bearer $API_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"reason":"Terms violation"}' \
     "$API_URL/users/42/ban"

# Unban a user
curl -X POST -H "Authorization: Bearer $API_SECRET" \
     "$API_URL/users/42/unban"

# Revoke a payment
curl -X POST -H "Authorization: Bearer $API_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"reason":"Fraudulent transaction"}' \
     "$API_URL/payments/7/revoke"

# Enable maintenance mode
curl -X POST -H "Authorization: Bearer $API_SECRET" \
     "$API_URL/maintenance/enable"
```

### Using the Management Shell Script

```bash
export API_URL="http://your-domain.com/api"
export API_SECRET="your_api_secret"

# Users
bash scripts/manage.sh users list
bash scripts/manage.sh users list --status banned
bash scripts/manage.sh users get 42
bash scripts/manage.sh users ban 42 --reason "Spam"
bash scripts/manage.sh users unban 42
bash scripts/manage.sh users delete 42

# Payments
bash scripts/manage.sh payments list
bash scripts/manage.sh payments list --status pending
bash scripts/manage.sh payments revoke 7 --reason "Fraud"
bash scripts/manage.sh payments delete 7

# Maintenance
bash scripts/manage.sh maintenance status
bash scripts/manage.sh maintenance enable
bash scripts/manage.sh maintenance disable

# Logs (IPv6)
bash scripts/manage.sh logs list
bash scripts/manage.sh logs list --ip "::ffff:10."
```

---

## IPv6 Support

All client IP addresses are:
- Captured from the connection (Nginx passes `$remote_addr` to PHP)
- IPv4 addresses are mapped to IPv6 notation: `::ffff:192.168.1.1`
- Stored in the `access_logs` table with an `ip_version` column (4 or 6)
- Displayed in the admin panel and returned by the API in IPv6 format

---

## TLS / HTTPS

Uncomment the TLS section in `nginx/nginx.conf` and obtain a certificate:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

---

## Security Notes

- Change the default admin password immediately after setup
- Keep `API_SECRET` private — treat it like a password
- The `.env` file and `maintenance.flag` are denied by Nginx (`*.flag` → deny all)
- All user input is validated and uses PDO prepared statements
- CSRF tokens protect all admin panel forms
