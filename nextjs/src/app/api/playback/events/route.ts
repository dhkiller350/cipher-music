import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateAccessToken } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/**
 * GET /api/playback/events — Server-Sent Events for real-time cross-device sync.
 * The client subscribes and receives playback state updates when another device
 * changes the playback position.
 */
export async function GET(request: NextRequest) {
  const result = await validateAccessToken(request);
  if ('error' in result) return result.error;
  const { payload } = result;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Send current state immediately
      const { data: current } = await supabase
        .from('playback_sessions')
        .select('*')
        .eq('user_id', payload.sub)
        .single();

      send({ type: 'state', payload: current ?? null });

      // Poll for changes every 2 seconds (lightweight alternative to WebSockets)
      let lastUpdated = current?.updated_at ?? null;
      const interval = setInterval(async () => {
        const { data: latest } = await supabase
          .from('playback_sessions')
          .select('*')
          .eq('user_id', payload.sub)
          .single();

        if (latest && latest.updated_at !== lastUpdated) {
          lastUpdated = latest.updated_at;
          send({ type: 'update', payload: latest });
        }
      }, 2000);

      // Stop if the request is aborted
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
