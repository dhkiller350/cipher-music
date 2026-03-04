import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Verify Stripe webhook signature using Web Crypto API (works in Node.js + Edge)
async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string
): Promise<boolean> {
  const parts = sigHeader.split(',').reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts['t'];
  const signature = parts['v1'];
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(signedPayload);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const computed = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison
  if (computed.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const payload = await request.text();
  const sigHeader = request.headers.get('stripe-signature') ?? '';

  const valid = await verifyStripeSignature(payload, sigHeader, webhookSecret);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: {
    id: string;
    type: string;
    api_version?: string;
    livemode: boolean;
    created: number;
    data: { object: Record<string, unknown> };
  };

  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Idempotency: skip already-processed events
  const { data: existing } = await supabase
    .from('stripe_events')
    .select('id')
    .eq('id', event.id)
    .single();

  if (existing) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // Record the event
  await supabase.from('stripe_events').insert({
    id: event.id,
    type: event.type,
    api_version: event.api_version ?? null,
    livemode: event.livemode,
    created: event.created,
  });

  const obj = event.data.object as Record<string, unknown>;

  switch (event.type) {
    case 'checkout.session.completed': {
      const userEmail = (obj['customer_email'] ?? obj['client_reference_id']) as string | undefined;
      const intentId = obj['payment_intent'] as string | undefined;
      if (userEmail) {
        await supabase
          .from('payments')
          .update({ status: 'paid', stripe_event_id: event.id, stripe_payment_intent_id: intentId ?? null, updated_at: new Date().toISOString() })
          .eq('user_email', userEmail)
          .eq('status', 'pending');
        await supabase
          .from('accounts')
          .update({ plan: 'premium', updated_at: new Date().toISOString() })
          .eq('email', userEmail);
      }
      break;
    }
    case 'customer.subscription.updated': {
      const status = obj['status'] as string | undefined;
      const userEmail = obj['customer_email'] as string | undefined;
      if (userEmail) {
        const newPlan = status === 'active' ? 'premium' : 'free';
        await supabase
          .from('accounts')
          .update({ plan: newPlan, updated_at: new Date().toISOString() })
          .eq('email', userEmail);
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const userEmail = obj['customer_email'] as string | undefined;
      if (userEmail) {
        await supabase
          .from('accounts')
          .update({ plan: 'free', updated_at: new Date().toISOString() })
          .eq('email', userEmail);
      }
      break;
    }
    case 'setup_intent.created': {
      const intentId = obj['id'] as string | undefined;
      if (intentId) {
        await supabase
          .from('payments')
          .update({ status: 'setup_initiated', stripe_payment_intent_id: intentId, updated_at: new Date().toISOString() })
          .eq('stripe_payment_intent_id', intentId);
      }
      break;
    }
    case 'payment_intent.succeeded': {
      const intentId = obj['id'] as string | undefined;
      const userEmail = (obj['receipt_email'] ?? obj['customer_email']) as string | undefined;
      if (intentId) {
        await supabase
          .from('payments')
          .update({ status: 'paid', stripe_event_id: event.id, updated_at: new Date().toISOString() })
          .eq('stripe_payment_intent_id', intentId);
      }
      if (userEmail) {
        await supabase
          .from('accounts')
          .update({ plan: 'premium', updated_at: new Date().toISOString() })
          .eq('email', userEmail);
      }
      break;
    }
    case 'payment_intent.payment_failed': {
      const intentId = obj['id'] as string | undefined;
      const failedEmail = (obj['receipt_email'] ?? obj['customer_email']) as string | undefined;
      if (intentId) {
        await supabase
          .from('payments')
          .update({ status: 'failed', stripe_event_id: event.id, updated_at: new Date().toISOString() })
          .eq('stripe_payment_intent_id', intentId);
      }
      // Fraud detection: track failed payments per account
      if (failedEmail) {
        const { data: abuse } = await supabase
          .from('abuse_records')
          .select('failed_payments')
          .eq('user_email', failedEmail)
          .single();
        const newCount = (abuse?.failed_payments ?? 0) + 1;
        const autoflag = newCount >= 3;
        await supabase
          .from('abuse_records')
          .upsert(
            {
              user_email: failedEmail,
              failed_payments: newCount,
              flagged: autoflag,
              flagged_reason: autoflag ? 'Excessive payment failures' : null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_email' }
          );
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ ok: true });
}
