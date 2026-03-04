import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateAccessToken } from '@/lib/middleware';
import { getDefaultProvider } from '@/lib/providers';

export const dynamic = 'force-dynamic';

/** GET /api/tracks?q=... — search tracks and return unified IDs */
export async function GET(request: NextRequest) {
  const result = await validateAccessToken(request);
  if ('error' in result) return result.error;

  const q = request.nextUrl.searchParams.get('q');
  const provider = request.nextUrl.searchParams.get('provider') ?? 'youtube';

  if (q) {
    const svc = getDefaultProvider();
    const results = await svc.searchTracks(q, 20);

    // Upsert tracks into our unified table (let DB generate ID on insert)
    const upsertData = results.map((r) => ({
      provider: r.provider,
      provider_track_id: r.providerTrackId,
      title: r.title,
      artist: r.artist,
      duration: r.duration,
      artwork: r.artwork,
      updated_at: new Date().toISOString(),
    }));

    if (upsertData.length > 0) {
      await supabase
        .from('tracks')
        .upsert(upsertData, { onConflict: 'provider,provider_track_id', ignoreDuplicates: false });
    }

    // Return tracks with internal IDs
    const { data: tracks } = await supabase
      .from('tracks')
      .select('*')
      .eq('provider', provider)
      .in('provider_track_id', results.map((r) => r.providerTrackId));

    return NextResponse.json(tracks ?? []);
  }

  // List recently added tracks
  const { data, error } = await supabase
    .from('tracks')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** POST /api/tracks — register an internal track manually */
export async function POST(request: NextRequest) {
  const result = await validateAccessToken(request);
  if ('error' in result) return result.error;

  const body = await request.json();
  const { provider, providerTrackId, title, artist, duration, artwork } = body;

  if (!provider || !providerTrackId || !title) {
    return NextResponse.json({ error: 'provider, providerTrackId, and title are required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('tracks')
    .upsert(
      {
        provider,
        provider_track_id: providerTrackId,
        title,
        artist: artist ?? '',
        duration: duration ?? 0,
        artwork: artwork ?? '',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'provider,provider_track_id' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
