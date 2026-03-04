import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyPassword } from '@/lib/hash';
import { hashToken } from '@/lib/hash';
import { signAccessToken } from '@/lib/jwt';
import { extractDeviceInfo, rateLimitResponse, handlePreflight, applyCorsHeaders } from '@/lib/middleware';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

// Use SameSite=None + Secure for cross-origin (mobile) compatibility.
// Same-origin requests still receive SameSite=Lax cookies.
// CSRF protection is provided by origin validation in getAllowedOrigin():
// only requests from ALLOWED_ORIGINS receive CORS credentials, and the
// Authorization: Bearer token (set as a custom header) cannot be forged by
// cross-site requests even when cookies are present.
function cookieOpts(request: NextRequest) {
  const isSecure = process.env.NODE_ENV === 'production';
  const isCrossOrigin = !!request.headers.get('origin');
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: (isCrossOrigin && isSecure ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
  };
}

// Handle OPTIONS preflight (required by mobile browsers for cross-origin requests)
export async function OPTIONS(request: NextRequest) {
  const preflight = handlePreflight(request);
  return applyCorsHeaders(request, preflight ?? new NextResponse(null, { status: 204 }));
}

export async function POST(request: NextRequest) {
  // Rate-limit login attempts: 10 per minute per IP
  const limited = rateLimitResponse(request, 10, 60_000);
  if (limited) return applyCorsHeaders(request, limited);

  const body = await request.json();
  const { email, password } = body as { email?: string; password?: string };
  if (!email || !password) {
    return applyCorsHeaders(request, NextResponse.json({ error: 'email and password are required' }, { status: 400 }));
  }

  // Maintenance check (allow login during maintenance for admins)
  const { data: config } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'platform_status')
    .single();
  const isMaintenance = config?.value === 'maintenance';

  const { data: account, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('email', email)
    .single();

  if (error || !account) {
    return applyCorsHeaders(request, NextResponse.json({ error: 'Invalid credentials' }, { status: 401 }));
  }

  const valid = await verifyPassword(password, account.password_hash);
  if (!valid) {
    // Increment failed login count
    const { data: existingAbuse } = await supabase
      .from('abuse_records')
      .select('failed_logins')
      .eq('user_email', email)
      .single();
    await supabase
      .from('abuse_records')
      .upsert(
        { user_email: email, failed_logins: (existingAbuse?.failed_logins ?? 0) + 1, updated_at: new Date().toISOString() },
        { onConflict: 'user_email', ignoreDuplicates: false }
      );
    return applyCorsHeaders(request, NextResponse.json({ error: 'Invalid credentials' }, { status: 401 }));
  }

  if (account.banned) {
    return applyCorsHeaders(request, NextResponse.json({ error: 'Account is banned' }, { status: 403 }));
  }

  if (isMaintenance && account.role !== 'admin') {
    return applyCorsHeaders(request, NextResponse.json({ error: 'Platform is under maintenance', maintenance: true }, { status: 503 }));
  }

  const sessionId = randomUUID();
  const rawRefreshToken = randomUUID() + '-' + randomUUID();
  const hashedRefreshToken = hashToken(rawRefreshToken);
  const device = extractDeviceInfo(request);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Store hashed refresh token in DB
  await supabase.from('sessions').insert({
    id: sessionId,
    user_id: account.id,
    user_email: email,
    refresh_token_hash: hashedRefreshToken,
    user_agent: device.userAgent,
    ip: device.ip,
    region: device.region ?? null,
    expires_at: expiresAt,
  });

  // Store device fingerprint
  await supabase.from('device_fingerprints').upsert(
    {
      user_email: email,
      user_agent: device.userAgent,
      ip: device.ip,
      region: device.region ?? null,
      last_seen: new Date().toISOString(),
    },
    { onConflict: 'user_email,user_agent' }
  );

  const accessToken = await signAccessToken({
    sub: account.id,
    email: account.email,
    plan: account.plan,
    banned: account.banned,
    sessionId,
  });

  const opts = cookieOpts(request);
  const response = NextResponse.json({
    accessToken,
    user: { id: account.id, email: account.email, username: account.username, plan: account.plan },
  });

  response.cookies.set('refresh_token', rawRefreshToken, { ...opts, maxAge: 30 * 24 * 60 * 60 });
  response.cookies.set('access_token', accessToken, { ...opts, maxAge: 15 * 60 });

  return applyCorsHeaders(request, response);
}
