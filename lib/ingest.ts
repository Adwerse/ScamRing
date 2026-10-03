// Owner: TBD
// STUB. Real version: extracts phones/emails/payment handles/IBANs from the text, HMACs them
// with IDENTIFIER_SECRET (raw values are never stored), builds masked identifierHints, hashes
// each photo with sharp (dhash + LSH bands, clusterId for near-duplicates), inserts the
// photos, and inserts the report with identifiers incl. 'img:<clusterId>'.
// Today: inserts a minimal report with empty identifiers.
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import type { Report, ReportStatus, Source } from '@/lib/types';

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

export async function ingestReport(input: IngestInput): Promise<Report> {
  const report: Report = {
    _id: new ObjectId(),
    source: input.source,
    text: input.text,
    area: input.area,
    kind: input.kind,
    bedrooms: input.bedrooms,
    priceEur: input.priceEur,
    photoIds: [],
    identifiers: [],
    identifierHints: [],
    status: input.status ?? 'pending',
    seed: input.seed ?? false,
    ...(input.seedRing ? { seedRing: input.seedRing } : {}),
    createdAt: new Date(),
  };
  const db = await getDb();
  await db.collection<Report>('reports').insertOne(report);
  return report;
}
