import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import type { ChangeStream } from 'mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const sid = (await cookies()).get('sr_sid')?.value;
  if (!sid) return Response.json({ error: 'Session required' }, { status: 401 });
  const live = new URL(request.url).searchParams.get('feed') === 'live';
  let changes: ChangeStream;
  try {
    const db = await getDb();
    changes = live
      ? db.collection('reports').watch(
          [
            {
              $match: {
                $or: [
                  { operationType: 'insert' },
                  {
                    operationType: 'update',
                    'updateDescription.updatedFields.status': { $exists: true },
                  },
                  {
                    operationType: 'update',
                    'updateDescription.updatedFields.verdict': { $exists: true },
                  },
                  // MongoDB stores dotted update paths as literal keys in updatedFields.
                  {
                    operationType: 'update',
                    $expr: {
                      $in: [
                        'verdict.level',
                        {
                          $map: {
                            input: {
                              $objectToArray: {
                                $ifNull: ['$updateDescription.updatedFields', {}],
                              },
                            },
                            as: 'field',
                            in: '$$field.k',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
          { fullDocument: 'updateLookup', maxAwaitTimeMS: 1000 },
        )
      : db
          .collection('alerts')
          .watch(
            [{ $match: { operationType: 'insert', 'fullDocument.sessionId': sid } }],
            { maxAwaitTimeMS: 1000 },
          );
  } catch {
    return Response.json({ error: 'Stream unavailable' }, { status: 503 });
  }
  const encoder = new TextEncoder();
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const ping = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': ping\n\n'));
      }, 15000);
      stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        request.signal.removeEventListener('abort', stop);
        void changes.close().catch(() => {});
        // Cancellation may have closed the ReadableStream already.
        try {
          controller.close();
        } catch {
          /* Already closed. */
        }
      };
      request.signal.addEventListener('abort', stop, { once: true });
      if (request.signal.aborted) {
        stop();
        return;
      }
      void (async () => {
        try {
          let event = await changes.tryNext();
          if (!closed) controller.enqueue(encoder.encode(': connected\n\n'));
          while (!closed) {
            if (event && 'fullDocument' in event && event.fullDocument) {
              const d = event.fullDocument;
              const data = live
                ? {
                    area: d.area,
                    priceEur: d.priceEur,
                    level: d.verdict?.level ?? null,
                    status: d.status,
                    at: new Date().toISOString(),
                  }
                : d;
              controller.enqueue(
                encoder.encode(
                  `event: ${live ? 'live' : 'alert'}\ndata: ${JSON.stringify(data)}\n\n`,
                ),
              );
            }
            event = await changes.tryNext();
          }
        } catch {
          stop();
        }
      })();
    },
    cancel() {
      stop();
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
