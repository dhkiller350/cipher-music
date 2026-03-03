# Cipher Music — Admin Dashboard

A **PHP-based** admin panel for the owner/creator to manage payments, users, and access logs.

## Files

| File | Description |
|------|-------------|
| `index.php` | PIN-protected dashboard — payments, users, logs, maintenance |
| `admin.php` | **Terminal CLI** — all admin operations from VSCode / SSH |
| `notify.php` | POST endpoint called by the app when a user submits payment |
| `users.php` | User sync endpoint (POST = register, GET/DELETE = admin) |
| `api.php` | REST API — users, payments, banned list, access log |
| `access_log.php` | Access log endpoint (login/signup events from any device) |
| `status.php` | Maintenance mode toggle API |
| `maintenance.php` | Legacy maintenance toggle (use `admin.php` instead) |
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
- **Admin dashboard**: http://localhost:8080/admin/index.php

In the **admin panel settings** (or app settings), set the Remote Server URL to:
```
http://localhost:8080/admin
```

From now on, every login, signup, and payment on any device/browser that is
pointed at your server will be logged and visible in the admin dashboard.

---

## Terminal CLI — All Commands

Every admin task can be done from the terminal with `php admin/admin.php`:

```bash
# ── Overview ──────────────────────────────────────────────────────────────────
php admin/admin.php status               # maintenance state + user/payment counts

# ── Maintenance mode ──────────────────────────────────────────────────────────
php admin/admin.php maintenance on       # enable  — all connected devices update in ~15s
php admin/admin.php maintenance off      # disable — all connected devices update in ~15s

# ── Live monitor (watch incoming payments + logins as they happen) ─────────────
php admin/admin.php watch                # poll every 3s, Ctrl+C to stop
php admin/admin.php watch --interval=5  # poll every 5s

# ── Users ─────────────────────────────────────────────────────────────────────
php admin/admin.php users                # list all users
php admin/admin.php users --limit=10    # show newest 10

# ── Access log (logins / signups) ─────────────────────────────────────────────
php admin/admin.php logs                 # show all recent events
php admin/admin.php logs --limit=20     # show newest 20
php admin/admin.php clear-logs          # wipe the access log

# ── Payments ──────────────────────────────────────────────────────────────────
php admin/admin.php payments             # list all payments (pending/confirmed/revoked)
php admin/admin.php payments --limit=10 # show newest 10
php admin/admin.php confirm PAY-ABCD1234  # approve a pending payment
php admin/admin.php revoke  PAY-ABCD1234  # revoke a payment

# ── Bans ──────────────────────────────────────────────────────────────────────
php admin/admin.php ban   user@example.com   # ban + remove account
php admin/admin.php unban user@example.com   # remove from ban list
php admin/admin.php bans                      # list all banned emails
```

---

## How It All Works

### Seeing users and incoming payments through the terminal

1. **Start the server** with `./start-server.sh` (or deploy to a VPS).
2. Open a second terminal tab and run:
   ```bash
   php admin/admin.php watch
   ```
   This polls every 3 seconds and prints a line for each new payment or login/signup
   as soon as it is written to the data files. You'll see output like:
   ```
   💰  NEW PAYMENT  [PENDING]  PRO  alice@example.com  ref=CPH-A1B2C3D4  2026-03-03T10:00:00+00:00
      → confirm: php admin/admin.php confirm CPH-A1B2C3D4
      → revoke : php admin/admin.php revoke  CPH-A1B2C3D4
   🆕  SIGNUP  alice@example.com  username=alice  ip=1.2.3.4  2026-03-03T10:00:05+00:00
      → ban: php admin/admin.php ban alice@example.com
   🔓  LOGIN   alice@example.com  username=alice  ip=1.2.3.4  2026-03-03T10:01:00+00:00
   ```

3. To see everything at once (not live), use:
   ```bash
   php admin/admin.php status     # counts + maintenance state
   php admin/admin.php users      # full user list
   php admin/admin.php payments   # full payment list with status
   php admin/admin.php logs       # full access log
   ```

### How account ban works

When you run `php admin/admin.php ban user@example.com`:
1. The user is **removed** from `data/users.json`
2. Their email is **added** to `data/banned.json`
3. Next time the app tries to log in or register that email, the server refuses it
4. The app also downloads the banned list on startup and blocks the email client-side

To reverse it: `php admin/admin.php unban user@example.com`

### How payment confirm / revoke works

When a user submits a payment screenshot in the app, the app POSTs to `notify.php`
which writes a record to `data/payments.json` with `status=pending`.

**To approve:**
```bash
php admin/admin.php confirm CPH-A1B2C3D4
```
This sets `status=confirmed` and `confirmed_at` timestamp.  The next time the app
syncs with the server it will unlock the paid plan for that user.

**To revoke:**
```bash
php admin/admin.php revoke CPH-A1B2C3D4
```
This sets `status=revoked` and `revoked_at` timestamp. The app will lock the plan.

### Running everything over SSH (remote server)

```bash
# Check server status from your laptop
ssh user@yourserver "php /var/www/cipher-music/admin/admin.php status"

# Watch live traffic from your laptop
ssh user@yourserver "php /var/www/cipher-music/admin/admin.php watch"

# Approve a payment remotely
ssh user@yourserver "php /var/www/cipher-music/admin/admin.php confirm CPH-A1B2C3D4"

# Turn maintenance on/off remotely
ssh user@yourserver "php /var/www/cipher-music/admin/admin.php maintenance on"
ssh user@yourserver "php /var/www/cipher-music/admin/admin.php maintenance off"
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

