import type { MusicProviderService } from './MusicProviderService';
import { YouTubeProvider } from './YouTubeProvider';

const providers: Record<string, MusicProviderService> = {
  youtube: new YouTubeProvider(),
};

export function getProvider(name: string): MusicProviderService {
  const p = providers[name];
  if (!p) throw new Error(`Unknown music provider: ${name}`);
  return p;
}

export function getDefaultProvider(): MusicProviderService {
  return providers['youtube'];
}

export type { MusicProviderService } from './MusicProviderService';
export type { TrackResult } from './MusicProviderService';
