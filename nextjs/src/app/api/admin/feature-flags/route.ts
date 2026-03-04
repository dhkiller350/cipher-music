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

export async function GET() {
  const { data, error } = await supabase.from('feature_flags').select('*');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const check = await requireAdmin(request);
  if ('error' in check) return check.error;

  const body = await request.json();
  const { name, enabled, description } = body as {
    name?: string;
    enabled?: boolean;
    description?: string;
  };
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('feature_flags')
    .upsert(
      { name, enabled: enabled ?? false, description: description ?? '', updated_at: new Date().toISOString() },
      { onConflict: 'name' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const check = await requireAdmin(request);
  if ('error' in check) return check.error;

  const body = await request.json();
  const { name, enabled } = body as { name?: string; enabled?: boolean };
  if (!name || enabled === undefined) {
    return NextResponse.json({ error: 'name and enabled are required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('feature_flags')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('name', name)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
