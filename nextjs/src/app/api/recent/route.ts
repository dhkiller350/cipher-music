import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('recent_songs')
    .select('*')
    .eq('user_email', email)
    .order('played_at', { ascending: false })
    .limit(20);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, videoId, title, channel, thumb, playedAt } = body;
  if (!email || !videoId || !title) {
    return NextResponse.json({ error: 'email, videoId, and title are required' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('recent_songs')
    .upsert(
      {
        user_email: email,
        video_id: videoId,
        title,
        channel: channel ?? '',
        thumb: thumb ?? '',
        played_at: playedAt ?? new Date().toISOString(),
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
