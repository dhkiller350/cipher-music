<?php
/**
 * Cipher Music — Stripe Webhook Endpoint
 *
 * Stripe will POST signed events to this URL.
 * Register it in the Stripe Dashboard under:
 *   Developers → Webhooks → Add endpoint
 *   URL: https://your-server/admin/webhook.php
 *
 * Events handled:
 *   setup_intent.created  — logged and matched against a pending
 *                           payment record via metadata.payment_ref
 *
 * Environment variables required:
 *   CIPHER_STRIPE_WEBHOOK_SECRET  — the "Signing secret" from your
 *                                   Stripe webhook dashboard (whsec_…)
 *
 * IMPORTANT: This endpoint must NOT require an X-Admin-Token — Stripe
 * cannot supply one.  Authentication is provided exclusively by the
 * Stripe-Signature HMAC verification below.
 */

// No CORS required — this is a server-to-server Stripe callback.
header('Content-Type: application/json');

// Only accept POST from Stripe
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method Not Allowed']);
    exit;
}

// ── Config ────────────────────────────────────────────────────────────────────
$WEBHOOK_SECRET  = getenv('CIPHER_STRIPE_WEBHOOK_SECRET') ?: '';
$PAYMENTS_FILE   = __DIR__ . '/data/payments.json';
$EVENTS_FILE     = __DIR__ . '/data/stripe_events.json';

// ── Read raw body (required for Stripe signature verification) ────────────────
$payload = file_get_contents('php://input');

// ── Verify Stripe-Signature ───────────────────────────────────────────────────
$sig_header = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';

if ($WEBHOOK_SECRET !== '') {
    if (!_cipher_stripe_verify($payload, $sig_header, $WEBHOOK_SECRET)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Webhook signature verification failed']);
        exit;
    }
}

// ── Parse event ───────────────────────────────────────────────────────────────
$event = json_decode($payload ?: '{}', true);
if (empty($event['type'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid event payload']);
    exit;
}

$event_type = $event['type'];
$event_id   = $event['id'] ?? '';

// ── Log all received events ───────────────────────────────────────────────────
_cipher_log_stripe_event($event, $EVENTS_FILE);

// ── Handle known event types ──────────────────────────────────────────────────
switch ($event_type) {

    case 'setup_intent.created':
        /**
         * Fired when Stripe creates a SetupIntent (customer begins card setup).
         *
         * The front-end may embed a "payment_ref" in the SetupIntent metadata
         * so we can correlate this event with a pending payment in our records.
         * If found, the payment status is updated to "setup_initiated".
         */
        $setup_intent = $event['data']['object'] ?? [];
        $payment_ref  = _cipher_get_payment_ref($setup_intent);

        if ($payment_ref) {
            _cipher_update_payment_status($payment_ref, 'setup_initiated', [
                'stripe_setup_intent_id' => $setup_intent['id'] ?? '',
                'stripe_event_id'        => $event_id,
            ], $PAYMENTS_FILE);
        }

        error_log("[Cipher] STRIPE setup_intent.created | event={$event_id} ref={$payment_ref}");
        break;

    // Future event types can be added here:
    // case 'payment_intent.succeeded': ...
    // case 'setup_intent.succeeded':   ...

    default:
        // Return 200 for unhandled events so Stripe does not retry them.
        break;
}

// ── Respond 200 to acknowledge receipt ───────────────────────────────────────
http_response_code(200);
echo json_encode(['ok' => true, 'type' => $event_type]);
exit;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Verify the Stripe-Signature header against the raw payload.
 * Implements Stripe's HMAC-SHA256 webhook signature scheme without requiring
 * the Stripe PHP SDK.  See https://stripe.com/docs/webhooks/signatures
 *
 * @param string $payload     Raw request body (read before any parsing)
 * @param string $sig_header  Value of the Stripe-Signature HTTP header
 * @param string $secret      Webhook signing secret (whsec_…)
 * @param int    $tolerance   Maximum age of the timestamp in seconds (default 300)
 */
function _cipher_stripe_verify(
    string $payload,
    string $sig_header,
    string $secret,
    int $tolerance = 300
): bool {
    // Parse header: t=TIMESTAMP,v1=SIG1,v1=SIG2,...
    $parts = explode(',', $sig_header);
    $timestamp = null;
    $signatures = [];

    foreach ($parts as $part) {
        $part = trim($part);
        if (strncmp($part, 't=', 2) === 0) {
            $timestamp = (int) substr($part, 2);
        } elseif (strncmp($part, 'v1=', 3) === 0) {
            $signatures[] = substr($part, 3);
        }
    }

    if ($timestamp === null || empty($signatures)) {
        return false;
    }

    // Reject stale events
    if (abs(time() - $timestamp) > $tolerance) {
        return false;
    }

    // Compute expected HMAC
    $signed_payload = $timestamp . '.' . $payload;
    $expected = hash_hmac('sha256', $signed_payload, $secret);

    // Constant-time comparison against any v1 signature in the header
    foreach ($signatures as $sig) {
        if (hash_equals($expected, $sig)) {
            return true;
        }
    }

    return false;
}

/**
 * Append the event to stripe_events.json, creating the file if necessary.
 * Uses an exclusive file lock to prevent race conditions under concurrent requests.
 */
function _cipher_log_stripe_event(array $event, string $file): void {
    $dir = dirname($file);
    if (!is_dir($dir)) mkdir($dir, 0700, true);

    $fh = fopen($file, 'c+');
    if (!$fh) return;
    flock($fh, LOCK_EX);

    $content = stream_get_contents($fh);
    $events  = json_decode($content ?: '[]', true) ?: [];

    // Avoid duplicate event IDs (Stripe may retry)
    $event_id = $event['id'] ?? '';
    foreach ($events as $e) {
        if (($e['id'] ?? '') === $event_id) {
            flock($fh, LOCK_UN);
            fclose($fh);
            return; // already logged
        }
    }

    $events[] = [
        'id'          => $event_id,
        'type'        => $event['type'] ?? '',
        'api_version' => $event['api_version'] ?? '',
        'livemode'    => $event['livemode'] ?? false,
        'created'     => $event['created'] ?? 0,
        'received_at' => date('c'),
    ];

    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($events, JSON_PRETTY_PRINT));
    flock($fh, LOCK_UN);
    fclose($fh);
}

/**
 * Extract our internal payment reference from a Stripe object's metadata.
 * We store it as metadata.payment_ref when creating the SetupIntent/PaymentIntent.
 */
function _cipher_get_payment_ref(array $stripe_object): string {
    return trim($stripe_object['metadata']['payment_ref'] ?? '');
}

/**
 * Update the status (and optionally merge extra fields) for a payment record
 * identified by its internal reference.
 * Uses an exclusive file lock to prevent race conditions under concurrent requests.
 */
function _cipher_update_payment_status(
    string $ref,
    string $status,
    array  $extra,
    string $file
): void {
    if (!file_exists($file)) return;

    $fh = fopen($file, 'c+');
    if (!$fh) return;
    flock($fh, LOCK_EX);

    $content  = stream_get_contents($fh);
    $payments = json_decode($content ?: '[]', true) ?: [];
    $updated  = false;

    foreach ($payments as &$payment) {
        if (($payment['ref'] ?? '') === $ref) {
            $payment['status']     = $status;
            $payment['updated_at'] = date('c');
            foreach ($extra as $k => $v) {
                $payment[$k] = $v;
            }
            $updated = true;
            break;
        }
    }
    unset($payment);

    if ($updated) {
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($payments, JSON_PRETTY_PRINT));
    }

    flock($fh, LOCK_UN);
    fclose($fh);
}
