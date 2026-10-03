// Owner: D (built by B)
// GET /api/stream: server-sent events with this session's new alerts (cookie sr_sid).
// Sends an 'alert' event per alert created after the stream opened, and a comment every
// HEARTBEAT_MS so proxies keep the connection open.
import { getDb } from '@/lib/db';
import type { Alert } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const POLL_MS = 1000;
const HEARTBEAT_MS = 15000;

function sessionOf(request: Request): string | null {
  const cookie = request.headers.get('cookie') ?? '';
  return cookie.match(/(?:^|;\s*)sr_sid=([^;]+)/)?.[1] ?? null;
}

export async function GET(request: Request) {
  const sessionId = sessionOf(request);
  if (!sessionId) return new Response('no session', { status: 400 });
  const alerts = (await getDb()).collection<Alert>('alerts');
  const encoder = new TextEncoder();
  let since = new Date();

  const stream = new ReadableStream({
    start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      send('retry: 3000\n\n');
      const poll = setInterval(async () => {
        try {
          const fresh = await alerts.find({ sessionId, createdAt: { $gt: since } }).sort({ createdAt: 1 }).toArray();
          for (const alert of fresh) {
            since = alert.createdAt;
            const payload = { ...alert, _id: alert._id.toString(), reportId: alert.reportId.toString(), triggerReportId: alert.triggerReportId.toString() };
            send(`event: alert\ndata: ${JSON.stringify(payload)}\n\n`);
          }
        } catch (error) {
          console.error('stream poll failed', error);
        }
      }, POLL_MS);
      const heartbeat = setInterval(() => send(': keep-alive\n\n'), HEARTBEAT_MS);
      request.signal.addEventListener('abort', () => {
        clearInterval(poll);
        clearInterval(heartbeat);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
