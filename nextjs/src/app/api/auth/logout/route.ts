import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { hashToken } from '@/lib/hash';
import { handlePreflight, applyCorsHeaders } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  const preflight = handlePreflight(request);
  return applyCorsHeaders(request, preflight ?? new NextResponse(null, { status: 204 }));
}

export async function POST(request: NextRequest) {
  const rawToken = request.cookies.get('refresh_token')?.value;

  if (rawToken) {
    // Delete the session identified by the token hash (opaque token design)
    const tokenHash = hashToken(rawToken);
    await supabase.from('sessions').delete().eq('refresh_token_hash', tokenHash);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set('refresh_token', '', { httpOnly: true, maxAge: 0, path: '/' });
  response.cookies.set('access_token', '', { httpOnly: true, maxAge: 0, path: '/' });
  return applyCorsHeaders(request, response);
}
