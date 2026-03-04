import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateAccessToken, checkMaintenanceMode } from '@/lib/middleware';
import { getProvider } from '@/lib/providers';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { trackId: string } }
) {
  // 1. Validate auth
  const authResult = await validateAccessToken(request);
  if ('error' in authResult) return authResult.error;
  const { payload } = authResult;

  // 2. Check maintenance mode
  const isAdmin = false; // check role from DB if needed
  const maintenance = await checkMaintenanceMode(isAdmin);
  if (maintenance) return maintenance;

  // 3. Check not banned
  if (payload.banned) {
    return NextResponse.json({ error: 'Account is banned' }, { status: 403 });
  }

  // 4. Check subscription
  if (payload.plan === 'free') {
    return NextResponse.json({ error: 'Subscription required to stream' }, { status: 403 });
  }

  // 5. Look up internal track
  const { data: track, error } = await supabase
    .from('tracks')
    .select('*')
    .eq('id', params.trackId)
    .single();

  if (error || !track) {
    return NextResponse.json({ error: 'Track not found' }, { status: 404 });
  }

  // 6. Get stream URL from provider
  const provider = getProvider(track.provider);
  const streamUrl = await provider.getStreamUrl(track.provider_track_id);

  if (!streamUrl) {
    return NextResponse.json({ error: 'Stream URL unavailable' }, { status: 503 });
  }

  return NextResponse.json({
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    artwork: track.artwork,
    streamUrl,
    provider: track.provider,
  });
}
