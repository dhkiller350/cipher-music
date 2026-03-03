# Cipher Music — Admin Dashboard

A **PHP-based** admin panel for the owner/creator to manage payments, users, and access logs.

## Files

| File | Description |
|------|-------------|
| `index.php` | PIN-protected dashboard — payments, users, logs, maintenance |
| `notify.php` | POST endpoint called by the app when a user submits payment |
| `users.php` | User sync endpoint (POST = register, GET/DELETE = admin) |
| `api.php` | REST API — users, payments, banned list, access log |
| `access_log.php` | Access log endpoint (login/signup events from any device) |
| `status.php` | Maintenance mode toggle API |
| `maintenance.php` | CLI tool — toggle maintenance from Ubuntu terminal |
| `cors.php` | Shared CORS + IPv6 helper (included by all endpoints) |
| `data/payments.json` | Payments database (created automatically) |
| `data/users.json` | Users database (created automatically) |
| `data/banned.json` | Banned emails list (created automatically) |
| `data/access_log.json` | Login/signup access log (created automatically) |
| `data/status.json` | Maintenance mode state (created automatically) |
| `.htaccess` | Restricts web access to only the listed PHP endpoints |
| `data/.htaccess` | Blocks all direct access to the `data/` folder |

---

## Quick Start — VS Code / Ubuntu Terminal (no remote server needed)

From the **VS Code terminal** (or any Ubuntu terminal) in the repository root:

```bash
# Install PHP if not already installed
sudo apt install php-cli

# Start the dev server
./start-server.sh
```

Open your browser and go to:
- **App**: http://localhost:8080
- **Admin panel**: http://localhost:8080/admin/index.php

In the **admin panel settings** (or app settings), set the Remote Server URL to:
```
http://localhost:8080/admin
```

From now on, every login, signup, and payment on any device/browser that is
pointed at your server will be logged and visible in the admin dashboard.

### Terminal commands for maintenance mode

```bash
# Enable maintenance (from terminal)
php admin/maintenance.php on

# Disable maintenance (from terminal)
php admin/maintenance.php off

# Check current status
php admin/maintenance.php status

# Also create/remove nginx flag file (requires sudo for /var/www)
php admin/maintenance.php on  --nginx
php admin/maintenance.php off --nginx
```

---

## Setup on a real server (nginx + PHP-FPM)

1. Copy this repo to `/var/www/cipher-music/`.
2. Copy `nginx.conf` to `/etc/nginx/sites-available/cipher-music` and enable it.
3. Set the `CIPHER_ADMIN_PIN_HASH` environment variable:
   ```bash
   echo -n "your_pin_here" | sha256sum
   # then add to /etc/environment or your PHP-FPM pool's env block
   ```
4. Make `data/` writable:
   ```bash
   chmod 700 /var/www/cipher-music/admin/data
   chown www-data:www-data /var/www/cipher-music/admin/data
   ```
5. In `app.js`, set `ADMIN_NOTIFY_URL` to your server:
   ```js
   ADMIN_NOTIFY_URL: 'https://yourdomain.com/admin/notify.php'
   ```
   Or, set the **Remote Server URL** in the admin panel UI after deploying.

---

## API Reference

All API endpoints require the `X-Admin-Token` header (SHA-256 of your PIN).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `api.php?resource=users` | List all users |
| DELETE | `api.php?resource=users&email=x` | Delete user & ban |
| GET | `api.php?resource=payments` | List all payments |
| POST | `api.php?resource=payments` | `{action:"confirm"\|"revoke", ref:"..."}` |
| DELETE | `api.php?resource=payments&ref=x` | Delete payment record |
| GET | `api.php?resource=banned` | List banned emails |
| PATCH | `api.php?resource=banned` | `{email:"..."}` — unban |
| GET | `api.php?resource=access_log` | List access log entries |
| DELETE | `api.php?resource=access_log` | Clear log (optionally `{email:"..."}`) |
| GET | `api.php?resource=status` | Health check |
| POST | `access_log.php` | Log an event (public, no auth) |
| POST | `status.php` | Set maintenance mode (auth required) |

---

## Activation Code

The 10-character code is computed deterministically from:
```
plan | email | ref | CM2026_CIPHER
```
using the same algorithm as `app.js → generateActivationCode()`.
You can also generate codes manually in the browser console:
```js
generateActivationCode('pro', 'user@email.com', 'CPH-XXXXXXXX')
```

