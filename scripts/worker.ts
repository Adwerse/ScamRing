import { config } from 'dotenv';
import type { ChangeStream, ResumeToken } from 'mongodb';
import { getClient, getDb } from '@/lib/db';
import { fanOut } from '@/lib/fanout';

config({ path: '.env', quiet: true });

let stopping = false;

let stream: ChangeStream | undefined;

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    stopping = true;
    void stream?.close();
  });

async function main() {
  const db = await getDb();
  const meta = db.collection<{ _id: string; resumeToken?: ResumeToken }>('meta');
  while (!stopping) {
    try {
      const token = (await meta.findOne({ _id: 'worker' }))?.resumeToken;
      stream = db.collection('reports').watch(
        [
          {
            $match: {
              operationType: 'update',
              'updateDescription.updatedFields.status': 'confirmed_scam',
            },
          },
        ],
        { fullDocument: 'updateLookup', ...(token ? { resumeAfter: token } : {}) },
      );
      console.log('worker: watching confirmations');
      for await (const event of stream) {
        if (event.operationType !== 'update') continue;
        await fanOut(event.documentKey._id.toString());
        await meta.updateOne(
          { _id: 'worker' },
          { $set: { resumeToken: event._id } },
          { upsert: true },
        );
        console.log(`worker: confirmation handled ${event.documentKey._id}`);
      }
    } catch {
      if (!stopping) {
        console.error('worker: processing failed; retrying from saved token in 3s');
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } finally {
      await stream?.close();
    }
  }
  await (await getClient()).close();
}

main().catch(() => {
  console.error('worker: could not connect; check local configuration');
  process.exitCode = 1;
});
