export interface TrackResult {
  providerTrackId: string;
  provider: string;
  title: string;
  artist: string;
  duration: number; // seconds
  artwork: string;
  streamable: boolean;
}

export interface MusicProviderService {
  readonly name: string;
  searchTracks(query: string, limit?: number): Promise<TrackResult[]>;
  getTrack(providerTrackId: string): Promise<TrackResult | null>;
  getStreamUrl(providerTrackId: string): Promise<string | null>;
  getPlaylist(playlistId: string): Promise<TrackResult[]>;
}
