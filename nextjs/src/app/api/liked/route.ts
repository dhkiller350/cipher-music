import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('liked_songs')
    .select('*')
    .eq('user_email', email)
    .order('liked_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, videoId, title, channel, thumb } = body;
  if (!email || !videoId || !title) {
    return NextResponse.json({ error: 'email, videoId, and title are required' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('liked_songs')
    .upsert(
      {
        user_email: email,
        video_id: videoId,
        title,
        channel: channel ?? '',
        thumb: thumb ?? '',
        liked_at: new Date().toISOString(),
      },
      { onConflict: 'user_email,video_id' }
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
  const videoId = request.nextUrl.searchParams.get('videoId');
  if (!email || !videoId) {
    return NextResponse.json({ error: 'email and videoId are required' }, { status: 400 });
  }
  const { error } = await supabase
    .from('liked_songs')
    .delete()
    .eq('user_email', email)
    .eq('video_id', videoId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
