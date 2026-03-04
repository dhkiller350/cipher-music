import type { MusicProviderService, TrackResult } from './MusicProviderService';

const YT_API_KEY = process.env.YOUTUBE_API_KEY ?? '';
const YT_BASE = 'https://www.googleapis.com/youtube/v3';

interface YTItem {
  id: { videoId?: string } | string;
  snippet?: {
    title: string;
    channelTitle: string;
    thumbnails?: { medium?: { url?: string } };
  };
  contentDetails?: { duration?: string };
}

function parseISODuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] ?? '0') * 3600) + (parseInt(m[2] ?? '0') * 60) + parseInt(m[3] ?? '0');
}

function itemToTrack(item: YTItem): TrackResult {
  const videoId = typeof item.id === 'string' ? item.id : item.id.videoId ?? '';
  return {
    providerTrackId: videoId,
    provider: 'youtube',
    title: item.snippet?.title ?? '',
    artist: item.snippet?.channelTitle ?? '',
    duration: item.contentDetails?.duration ? parseISODuration(item.contentDetails.duration) : 0,
    artwork: item.snippet?.thumbnails?.medium?.url ?? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    streamable: true,
  };
}

export class YouTubeProvider implements MusicProviderService {
  readonly name = 'youtube';

  async searchTracks(query: string, limit = 10): Promise<TrackResult[]> {
    if (!YT_API_KEY) return [];
    const url = `${YT_BASE}/search?part=snippet&type=video&videoCategoryId=10&q=${encodeURIComponent(query)}&maxResults=${limit}&key=${YT_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json() as { items?: YTItem[] };
    return (json.items ?? []).map(itemToTrack);
  }

  async getTrack(providerTrackId: string): Promise<TrackResult | null> {
    if (!YT_API_KEY) return null;
    const url = `${YT_BASE}/videos?part=snippet,contentDetails&id=${providerTrackId}&key=${YT_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json() as { items?: YTItem[] };
    const item = json.items?.[0];
    if (!item) return null;
    return itemToTrack({ ...item, id: providerTrackId });
  }

  async getStreamUrl(providerTrackId: string): Promise<string | null> {
    // The actual stream URL is handled client-side via iframe/embed API.
    // Return an embed URL that the client can use.
    return `https://www.youtube.com/embed/${providerTrackId}?autoplay=1&enablejsapi=1`;
  }

  async getPlaylist(playlistId: string): Promise<TrackResult[]> {
    if (!YT_API_KEY) return [];
    const url = `${YT_BASE}/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&key=${YT_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json() as { items?: Array<{ snippet?: { resourceId?: { videoId?: string }; title?: string; channelTitle?: string; thumbnails?: { medium?: { url?: string } } } }> };
    return (json.items ?? []).map((item) => ({
      providerTrackId: item.snippet?.resourceId?.videoId ?? '',
      provider: 'youtube',
      title: item.snippet?.title ?? '',
      artist: item.snippet?.channelTitle ?? '',
      duration: 0,
      artwork: item.snippet?.thumbnails?.medium?.url ?? '',
      streamable: true,
    }));
  }
}
