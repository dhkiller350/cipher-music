import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
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
  const body = await request.json();
  const { username, email, passwordHash, memberSince, plan } = body;
  if (!username || !email || !passwordHash) {
    return NextResponse.json({ error: 'username, email, and passwordHash are required' }, { status: 400 });
  }
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
    .select()
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
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
