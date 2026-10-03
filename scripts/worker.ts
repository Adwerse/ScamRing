// Consume committed moderation audit events. Checkpoint only after successful delivery.
import { config } from 'dotenv';
config({ path: ['.env.local', '.env'], quiet: true });
import type { ChangeStream, ChangeStreamInsertDocument, ResumeToken } from 'mongodb';
import { getClient, getDb } from '../lib/db';
import { fanOut, refreshVerdicts } from '../lib/fanout';
import type { ModerationEvent } from '../lib/types';

const RESUME_KEY = 'worker_resume_token';
const RETRY_MS = 3000;
let stopping = false;
let stream: ChangeStream<ModerationEvent, ChangeStreamInsertDocument<ModerationEvent>> | undefined;
let wake: (() => void) | undefined;
const pause = () => new Promise<void>((resolve) => {
  const timer = setTimeout(() => { wake = undefined; resolve(); }, RETRY_MS);
  wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true;
    wake?.();
    void stream?.close().catch(() => {});
  });
}

async function main() {
  if (process.env.FANOUT_INLINE === '1') {
    console.log('FANOUT_INLINE=1: alerts are delivered by the moderation route; worker idle');
    return;
  }
  const database = await getDb();
  const meta = database.collection<{ _id: string; token?: ResumeToken; pending?: { reportId: string; token: ResumeToken } }>('meta');
  const checkpoint = async (token: ResumeToken) => {
    await meta.updateOne({ _id: RESUME_KEY }, { $set: { token }, $unset: { pending: '' } }, { upsert: true });
  };
  while (!stopping) {
    try {
      const saved = await meta.findOne({ _id: RESUME_KEY });
      if (saved?.pending) {
        await fanOut(saved.pending.reportId);
        await checkpoint(saved.pending.token);
        saved.token = saved.pending.token;
        await refreshVerdicts(saved.pending.reportId);
      }
      stream = database.collection<ModerationEvent>('moderation_events')
        .watch<ModerationEvent, ChangeStreamInsertDocument<ModerationEvent>>(
          [{ $match: { operationType: 'insert', 'fullDocument.action': 'confirm' } }],
          { ...(saved?.token ? { resumeAfter: saved.token } : {}), maxAwaitTimeMS: 1000 },
        );
      console.log(`worker watching ${database.databaseName}.moderation_events`);
      while (!stopping) {
        const event = await stream.tryNext();
        if (!event) {
          // Save the initial/idle position too, so the first failed event survives restart.
          if (stream.resumeToken) await checkpoint(stream.resumeToken);
          continue;
        }
        // Persist work before delivery, even when this is the first observed event.
        let delivered = false;
        while (!stopping && !delivered) {
          try {
            await meta.updateOne({ _id: RESUME_KEY }, { $set: { pending: { reportId: event.fullDocument.reportId.toString(), token: event._id } } }, { upsert: true });
            const created = await fanOut(event.fullDocument.reportId.toString());
            await checkpoint(event._id);
            delivered = true;
            console.log(`confirmation ${event.fullDocument.reportId}: ${created} new alerts`);
            // Alerts are out; verdicts can take seconds and never block delivery or the checkpoint.
            await refreshVerdicts(event.fullDocument.reportId.toString());
          } catch {
            if (!stopping) {
              console.error('worker: delivery failed; retrying this event without advancing its checkpoint');
              await pause();
            }
          }
        }
      }
    } catch {
      if (!stopping) {
        console.error('worker: stream failed; reconnecting from saved checkpoint');
        await pause();
      }
    } finally {
      await stream?.close().catch(() => {});
    }
  }
}
main().catch(() => {
  console.error('worker: could not connect; check local configuration');
  process.exitCode = 1;
}).finally(async () => {
  if (process.env.FANOUT_INLINE !== '1') {
    try { await (await getClient()).close(); } catch { /* Connection was never established. */ }
  }
});
