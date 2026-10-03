// Owner: D (built by B)
// Watches moderation_events with a change stream and fans out alerts for every confirmation.
// Resumes after a restart from the token stored in meta. Idle when FANOUT_INLINE=1, because the
// moderation route then fans out itself.
// Usage: npm run worker (or npm run dev:all for web + worker)
import { config } from 'dotenv';
config({ path: '.env.local' });

import type { ChangeStreamInsertDocument, ResumeToken } from 'mongodb';
import { getDb } from '../lib/db';
import { fanOut } from '../lib/fanout';
import type { ModerationEvent } from '../lib/types';

const RESUME_KEY = 'worker_resume_token';

type Meta = { _id: string; token: ResumeToken };

async function main(): Promise<void> {
  if (process.env.FANOUT_INLINE === '1') {
    console.log('FANOUT_INLINE=1: the moderation route fans out itself; worker idle');
    return;
  }
  const database = await getDb();
  const meta = database.collection<Meta>('meta');
  const saved = await meta.findOne({ _id: RESUME_KEY });
  const stream = database
    .collection<ModerationEvent>('moderation_events')
    .watch<ModerationEvent, ChangeStreamInsertDocument<ModerationEvent>>(
      [{ $match: { operationType: 'insert', 'fullDocument.action': 'confirm' } }],
      saved ? { resumeAfter: saved.token } : {},
    );
  console.log(`worker watching ${database.databaseName}.moderation_events${saved ? ' (resumed)' : ''}`);
  for await (const change of stream) {
    const reportId = change.fullDocument.reportId.toString();
    try {
      const started = Date.now();
      const alerts = await fanOut(reportId);
      console.log(`confirmed ${reportId}: ${alerts} alerts in ${Date.now() - started} ms`);
    } catch (error) {
      console.error(`fan-out failed for ${reportId}`, error);
    }
    await meta.updateOne({ _id: RESUME_KEY }, { $set: { token: change._id } }, { upsert: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
