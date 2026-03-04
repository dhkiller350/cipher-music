import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateAccessToken } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

async function requireAdmin(request: NextRequest) {
  const result = await validateAccessToken(request);
  if ('error' in result) return { error: result.error };
  const { data: account } = await supabase
    .from('accounts')
    .select('role')
    .eq('id', result.payload.sub)
    .single();
  if (account?.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Admin required' }, { status: 403 }) };
  }
  return { payload: result.payload };
}

export async function GET(request: NextRequest) {
  const check = await requireAdmin(request);
  if ('error' in check) return check.error;

  const { data, error } = await supabase
    .from('platform_config')
    .select('*');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const check = await requireAdmin(request);
  if ('error' in check) return check.error;

  const body = await request.json();
  const { status } = body as { status?: 'active' | 'maintenance' };
  if (!status || !['active', 'maintenance'].includes(status)) {
    return NextResponse.json({ error: 'status must be "active" or "maintenance"' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('platform_config')
    .upsert(
      { key: 'platform_status', value: status, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
