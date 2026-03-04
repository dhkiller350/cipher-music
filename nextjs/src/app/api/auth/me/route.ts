import { NextRequest, NextResponse } from 'next/server';
import { validateAccessToken } from '@/lib/middleware';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const result = await validateAccessToken(request);
  if ('error' in result) return result.error;

  const { data: account } = await supabase
    .from('accounts')
    .select('id, email, username, plan, banned, member_since')
    .eq('id', result.payload.sub)
    .single();

  if (!account) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({ user: account });
}
