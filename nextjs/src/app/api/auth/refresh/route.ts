import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { signAccessToken } from '@/lib/jwt';
import { hashToken } from '@/lib/hash';
import { extractDeviceInfo, handlePreflight, applyCorsHeaders } from '@/lib/middleware';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

// Use SameSite=None + Secure for cross-origin (mobile) compatibility.
// CSRF protection: origin validation in getAllowedOrigin() ensures only
// configured origins receive CORS credentials.
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

export async function OPTIONS(request: NextRequest) {
  const preflight = handlePreflight(request);
  return applyCorsHeaders(request, preflight ?? new NextResponse(null, { status: 204 }));
}

export async function POST(request: NextRequest) {
  const rawToken = request.cookies.get('refresh_token')?.value;
  if (!rawToken) {
    return applyCorsHeaders(request, NextResponse.json({ error: 'No refresh token' }, { status: 401 }));
  }

  // Look up the session by hashing the raw token (opaque token design)
  const tokenHash = hashToken(rawToken);
  const { data: session } = await supabase
    .from('sessions')
    .select('*')
    .eq('refresh_token_hash', tokenHash)
    .single();

  if (!session) {
    return applyCorsHeaders(request, NextResponse.json({ error: 'Invalid or expired refresh token' }, { status: 401 }));
  }

  if (new Date(session.expires_at) < new Date()) {
    await supabase.from('sessions').delete().eq('id', session.id);
    return applyCorsHeaders(request, NextResponse.json({ error: 'Session expired' }, { status: 401 }));
  }

  // Fetch current user data
  const { data: account } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', session.user_id)
    .single();

  if (!account || account.banned) {
    await supabase.from('sessions').delete().eq('id', session.id);
    return applyCorsHeaders(request, NextResponse.json({ error: 'Account unavailable' }, { status: 403 }));
  }

  // Issue new session (token rotation — old session replaced)
  const newSessionId = randomUUID();
  const newRawRefreshToken = randomUUID() + '-' + randomUUID();
  const newHashedRefreshToken = hashToken(newRawRefreshToken);
  const device = extractDeviceInfo(request);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await supabase.from('sessions').delete().eq('id', session.id);
  await supabase.from('sessions').insert({
    id: newSessionId,
    user_id: account.id,
    user_email: account.email,
    refresh_token_hash: newHashedRefreshToken,
    user_agent: device.userAgent,
    ip: device.ip,
    region: device.region ?? null,
    expires_at: expiresAt,
  });

  const accessToken = await signAccessToken({
    sub: account.id,
    email: account.email,
    plan: account.plan,
    banned: account.banned,
    sessionId: newSessionId,
  });

  const opts = cookieOpts(request);
  const response = NextResponse.json({
    accessToken,
    user: { id: account.id, email: account.email, username: account.username, plan: account.plan },
  });

  response.cookies.set('refresh_token', newRawRefreshToken, { ...opts, maxAge: 30 * 24 * 60 * 60 });
  response.cookies.set('access_token', accessToken, { ...opts, maxAge: 15 * 60 });

  return applyCorsHeaders(request, response);
}
