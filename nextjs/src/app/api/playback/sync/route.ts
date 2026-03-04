import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateAccessToken } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/** GET /api/playback/sync — get current playback state */
export async function GET(request: NextRequest) {
  const result = await validateAccessToken(request);
  if ('error' in result) return result.error;
  const { payload } = result;

  const { data, error } = await supabase
    .from('playback_sessions')
    .select('*')
    .eq('user_id', payload.sub)
    .single();

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? null);
}

/** POST /api/playback/sync — update playback state */
export async function POST(request: NextRequest) {
  const result = await validateAccessToken(request);
  if ('error' in result) return result.error;
  const { payload } = result;

  const body = await request.json();
  const { currentTrackId, position, isPlaying } = body as {
    currentTrackId?: string;
    position?: number;
    isPlaying?: boolean;
  };

  const { data, error } = await supabase
    .from('playback_sessions')
    .upsert(
      {
        user_id: payload.sub,
        current_track_id: currentTrackId ?? null,
        position: position ?? 0,
        is_playing: isPlaying ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
