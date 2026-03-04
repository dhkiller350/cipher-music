import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { hashPassword } from '@/lib/hash';
import { rateLimitResponse } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('accounts')
    .select('id, email, username, plan, banned, member_since, created_at')
    .eq('email', email)
    .single();
  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  // Rate-limit signups: 5 per minute per IP
  const limited = rateLimitResponse(request, 5, 60_000);
  if (limited) return limited;

  // Maintenance check — block new signups in maintenance mode
  const { data: config } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'platform_status')
    .single();
  if (config?.value === 'maintenance') {
    return NextResponse.json({ error: 'Signups are disabled during maintenance', maintenance: true }, { status: 503 });
  }

  const body = await request.json();
  const { username, email, password, memberSince, plan } = body;
  if (!username || !email || !password) {
    return NextResponse.json({ error: 'username, email, and password are required' }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  const { data, error } = await supabase
    .from('accounts')
    .upsert(
      {
        username,
        email,
        password_hash: passwordHash,
        member_since: memberSince ?? new Date().toISOString(),
        plan: plan ?? 'free',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'email' }
    )
    .select('id, email, username, plan, banned, member_since')
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('accounts')
    .update({ banned: true, updated_at: new Date().toISOString() })
    .eq('email', email)
    .select('id, email, username, banned')
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

