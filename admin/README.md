# Cipher Music — Admin Payment Dashboard

A **PHP-based** admin panel for the owner/creator to manage pending CashApp payments.

## Files

| File | Description |
|------|-------------|
| `index.php` | PIN-protected dashboard (view/confirm/remove payments) |
| `notify.php` | POST endpoint called by the app when a user submits payment |
| `data/payments.json` | Payments database (created automatically, JSON) |
| `.htaccess` | Restricts web access to only `index.php` and `notify.php` |
| `data/.htaccess` | Blocks all direct access to the `data/` folder |

## Setup (one-time)

1. **Host this directory** on a PHP server (PHP ≥ 7.4).
2. **Set your admin PIN hash** — in a terminal run:
   ```bash
   echo -n "your_pin_here" | sha256sum
   ```
   Copy the hex result and either:
   - Set the `CIPHER_ADMIN_PIN_HASH` environment variable on your server, **or**
   - Paste it into `$ADMIN_PIN_HASH` in `index.php` (look for the `getenv('CIPHER_ADMIN_PIN_HASH')` line).

3. **Allow the app to notify you** — in `app.js`, set:
   ```js
   const ADMIN_NOTIFY_URL = 'https://yourdomain.com/admin/notify.php';
   ```

4. **Make sure `data/` is writable** by the web server:
   ```bash
   chmod 700 admin/data
   ```

## Usage

1. Open `/admin/index.php` in your browser.
2. Enter your PIN.
3. Pending payments appear in the top table.
4. Click **Confirm** to generate the activation code and mark as confirmed.
5. Send the activation code to the customer's email.
6. Customer enters it in the app to unlock their plan.

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
