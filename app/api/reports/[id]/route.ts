import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import type { Report } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

// Same fields and order as fixtures/report.json: no identifiers (only hints), no seedRing/expiresAt.
function publicReport(r: Report) {
  return {
    _id: r._id.toString(),
    source: r.source,
    text: r.text,
    area: r.area,
    kind: r.kind,
    bedrooms: r.bedrooms,
    priceEur: r.priceEur,
    photoIds: r.photoIds.map((id) => id.toString()),
    identifierHints: r.identifierHints,
    status: r.status,
    seed: r.seed,
    ...(r.verdict ? { verdict: r.verdict } : {}),
    createdAt: r.createdAt,
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f]{24}$/i.test(id)) return notFound();
  const report = await (await getDb()).collection<Report>('reports').findOne({ _id: new ObjectId(id) });
  return report ? NextResponse.json(publicReport(report)) : notFound();
}
