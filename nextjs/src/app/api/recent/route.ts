import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateAccessToken } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const result = await validateAccessToken(request);
  if ('error' in result) return result.error;
  const { payload } = result;

  const { data, error } = await supabase
    .from('recent_songs')
    .select('*')
    .eq('user_email', payload.email)
    .order('played_at', { ascending: false })
    .limit(20);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const result = await validateAccessToken(request);
  if ('error' in result) return result.error;
  const { payload } = result;

  const body = await request.json();
  const { videoId, title, channel, thumb, playedAt } = body;
  if (!videoId || !title) {
    return NextResponse.json({ error: 'videoId and title are required' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('recent_songs')
    .upsert(
      {
        user_email: payload.email,
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
