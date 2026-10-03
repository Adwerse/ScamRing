// Near-duplicate photo clustering. Each photo gets a dhash; photos sharing an LSH band with a
// stored photo are compared by Hamming distance and join that photo's cluster if close enough.
import { Binary, ObjectId } from 'mongodb';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '@/lib/db';
import { bands, dhash, hamming } from '@/lib/dhash';
import type { Photo } from '@/lib/types';

/** Max Hamming distance (of 64 bits) for two photos to count as the same picture. A teammate calibrates this. */
export const PHOTO_THRESHOLD = 10;

const CANDIDATE_LIMIT = 1000;
const BLOB_WIDTH = 640;
const BLOB_MAX_BYTES = 300 * 1024;
const BLOB_QUALITIES = [80, 70, 60, 50, 40, 30, 20];
const BLOB_MIN_WIDTH = 160;

export type ClusterResult = { photoId: ObjectId; clusterId: string; matchedDistance: number | null };

/** JPEG, 640 px wide, quality (then width) reduced until it is at most 300 KB. */
async function makeBlob(buffer: Buffer): Promise<Buffer> {
  let width = BLOB_WIDTH;
  while (true) {
    let out = Buffer.alloc(0);
    for (const quality of BLOB_QUALITIES) {
      out = await sharp(buffer)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality })
        .toBuffer();
      if (out.length <= BLOB_MAX_BYTES) return out;
    }
    if (width <= BLOB_MIN_WIDTH) return out;
    width = Math.max(BLOB_MIN_WIDTH, Math.round(width * 0.75));
  }
}

async function closestCluster(hash: string, [b0, b1, b2, b3]: string[]): Promise<{ clusterId: string; distance: number } | null> {
  const db = await getDb();
  const candidates = await db
    .collection<Photo>('photos')
    .find({ $or: [{ b0 }, { b1 }, { b2 }, { b3 }] }, { projection: { clusterId: 1, dhash: 1 } })
    .limit(CANDIDATE_LIMIT)
    .toArray();
  let best: { clusterId: string; distance: number } | null = null;
  for (const c of candidates) {
    const distance = hamming(hash, c.dhash);
    if (distance <= PHOTO_THRESHOLD && (!best || distance < best.distance)) best = { clusterId: c.clusterId, distance };
  }
  return best;
}

// Find-then-insert must not interleave inside one process, or two identical photos ingested
// concurrently (e.g. a batched seed import) would each start their own cluster.
let queue: Promise<unknown> = Promise.resolve();

function serialised<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function clusterAndInsert(buffer: Buffer, reportId: ObjectId): Promise<ClusterResult> {
  const hash = await dhash(buffer);
  const [b0, b1, b2, b3] = bands(hash);
  const blob = await makeBlob(buffer);
  const match = await closestCluster(hash, [b0, b1, b2, b3]);
  const photoId = new ObjectId();
  const clusterId = match?.clusterId ?? uuidv4();
  const db = await getDb();
  await db.collection<Photo>('photos').insertOne({ _id: photoId, reportId, clusterId, dhash: hash, b0, b1, b2, b3, createdAt: new Date() });
  await db.collection('photos_blob').insertOne({ _id: photoId, reportId, contentType: 'image/jpeg', data: new Binary(blob) });
  return { photoId, clusterId, matchedDistance: match?.distance ?? null };
}

export function clusterPhoto(buffer: Buffer, reportId: ObjectId): Promise<ClusterResult> {
  return serialised(() => clusterAndInsert(buffer, reportId));
}
