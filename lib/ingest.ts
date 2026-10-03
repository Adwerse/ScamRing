// Owner: A
// Turns a pasted listing into a stored Report: HMACs the contact identifiers found in the text
// (raw values are never stored, also not inside the stored text: they become '[phone]' etc.), clusters each photo (lib/photos) and adds 'img:<clusterId>'
// identifiers, then inserts the report. No verdict here (lib/verdict does that).
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { extractIdentifiers } from '@/lib/identifiers';
import { clusterPhoto, type ClusterResult } from '@/lib/photos';
import type { IdentifierHint, Report, ReportStatus, Source } from '@/lib/types';

export type IngestInput = {
  source: Source;
  text: string;
  area: string;
  kind: 'room' | 'whole';
  bedrooms: number | null;
  priceEur: number | null;
  photos: Buffer[];
  seed?: boolean;
  seedRing?: string;
  status?: ReportStatus;
};

const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function clusterAll(photos: Buffer[], reportId: ObjectId): Promise<ClusterResult[]> {
  const results: ClusterResult[] = [];
  for (const photo of photos) results.push(await clusterPhoto(photo, reportId));
  return results;
}

/** One 'img' hint per cluster: a thumbnail URL of its first photo. */
function imageHints(photos: ClusterResult[]): IdentifierHint[] {
  const firstOfCluster = new Map<string, ObjectId>();
  for (const p of photos) if (!firstOfCluster.has(p.clusterId)) firstOfCluster.set(p.clusterId, p.photoId);
  return [...firstOfCluster.values()].map((id) => ({ kind: 'img', hint: `/api/photos/${id}/thumb` }));
}

async function removePhotos(reportId: ObjectId): Promise<void> {
  const db = await getDb();
  await db.collection('photos').deleteMany({ reportId });
  await db.collection('photos_blob').deleteMany({ reportId });
}

export async function ingestReport(input: IngestInput): Promise<Report> {
  const _id = new ObjectId();
  const text = extractIdentifiers(input.text);
  let photos: ClusterResult[];
  try {
    photos = await clusterAll(input.photos, _id);
  } catch (err) {
    await removePhotos(_id);
    throw err;
  }
  const status = input.status ?? 'pending';
  const seed = input.seed ?? false;
  const now = new Date();
  const report: Report = {
    _id,
    source: input.source,
    text: text.redactedText,
    area: input.area,
    kind: input.kind,
    bedrooms: input.bedrooms,
    priceEur: input.priceEur,
    photoIds: photos.map((p) => p.photoId),
    identifiers: [...new Set([...text.identifiers, ...photos.map((p) => `img:${p.clusterId}`)])],
    identifierHints: [...text.hints, ...imageHints(photos)],
    status,
    seed,
    ...(input.seedRing ? { seedRing: input.seedRing } : {}),
    createdAt: now,
    ...(!seed && status === 'pending' ? { expiresAt: new Date(now.getTime() + PENDING_TTL_MS) } : {}),
  };
  try {
    await (await getDb()).collection<Report>('reports').insertOne(report);
  } catch (err) {
    await removePhotos(_id);
    throw err;
  }
  return report;
}
