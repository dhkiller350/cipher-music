import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRefreshToken } from '@/lib/jwt';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rawToken = request.cookies.get('refresh_token')?.value;

  if (rawToken) {
    try {
      const payload = await verifyRefreshToken(rawToken);
      await supabase.from('sessions').delete().eq('id', payload.sessionId);
    } catch {
      // Token invalid/expired — still clear cookies
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set('refresh_token', '', { httpOnly: true, maxAge: 0, path: '/' });
  response.cookies.set('access_token', '', { httpOnly: true, maxAge: 0, path: '/' });
  return response;
}
