// Owner: D (built by B)
// GET /api/moderation/queue: pending reports for moderators, highest score first.
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { Report } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIMIT = 50;

export async function GET() {
  try {
  const database = await getDb();
  const reports = await database
    .collection<Report>('reports')
    .aggregate<Report & { score: number }>([
      { $match: { status: 'pending' } },
      { $addFields: { score: { $ifNull: ['$verdict.score', -1] } } },
      { $sort: { score: -1, createdAt: -1 } },
      { $limit: LIMIT },
    ])
    .toArray();
  return NextResponse.json({
    reports: reports.map((report) => ({
      _id: report._id.toString(),
      source: report.source,
      text: report.text,
      area: report.area,
      kind: report.kind,
      bedrooms: report.bedrooms,
      priceEur: report.priceEur,
      status: report.status,
      seed: report.seed,
      ...(report.verdict ? { verdict: report.verdict } : {}),
      createdAt: report.createdAt,
    })),
  });
  } catch {
    return NextResponse.json({ error: 'Moderation queue unavailable' }, { status: 503 });
  }
}
