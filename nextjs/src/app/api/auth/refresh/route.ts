import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRefreshToken, signAccessToken } from '@/lib/jwt';
import { hashToken, compareTokenHash } from '@/lib/hash';
import { extractDeviceInfo } from '@/lib/middleware';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

export async function POST(request: NextRequest) {
  const rawToken = request.cookies.get('refresh_token')?.value;
  if (!rawToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
  }

  let jwtPayload: Awaited<ReturnType<typeof verifyRefreshToken>>;
  try {
    jwtPayload = await verifyRefreshToken(rawToken);
  } catch {
    return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 });
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', jwtPayload.sessionId)
    .single();

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 401 });
  }

  // Token rotation: verify stored hash matches
  const tokenMatches = compareTokenHash(rawToken, session.refresh_token_hash);
  if (!tokenMatches) {
    // Possible token theft — revoke ALL sessions for this user
    await supabase
      .from('sessions')
      .delete()
      .eq('user_id', session.user_id);
    return NextResponse.json({ error: 'Token reuse detected – all sessions revoked' }, { status: 401 });
  }

  if (new Date(session.expires_at) < new Date()) {
    await supabase.from('sessions').delete().eq('id', session.id);
    return NextResponse.json({ error: 'Session expired' }, { status: 401 });
  }

  // Fetch current user data
  const { data: account } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', session.user_id)
    .single();

  if (!account || account.banned) {
    await supabase.from('sessions').delete().eq('id', session.id);
    return NextResponse.json({ error: 'Account unavailable' }, { status: 403 });
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

  const response = NextResponse.json({
    accessToken,
    user: { id: account.id, email: account.email, username: account.username, plan: account.plan },
  });

  response.cookies.set('refresh_token', newRawRefreshToken, {
    ...COOKIE_OPTS,
    maxAge: 30 * 24 * 60 * 60,
  });
  response.cookies.set('access_token', accessToken, {
    ...COOKIE_OPTS,
    maxAge: 15 * 60,
  });

  return response;
}
