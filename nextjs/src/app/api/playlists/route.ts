import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('playlists')
    .select('*')
    .eq('user_email', email)
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, name, items } = body;
  if (!email || !name) {
    return NextResponse.json({ error: 'email and name are required' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('playlists')
    .upsert(
      {
        user_email: email,
        name,
        items: items ?? [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_email,name' }
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
  const name = request.nextUrl.searchParams.get('name');
  if (!email || !name) {
    return NextResponse.json({ error: 'email and name are required' }, { status: 400 });
  }
  const { error } = await supabase
    .from('playlists')
    .delete()
    .eq('user_email', email)
    .eq('name', name);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
