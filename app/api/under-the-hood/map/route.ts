import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { Report } from '@/lib/types';
import { isMapResponse, type MapListing } from '@/components/propertyMapData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const LIMIT = 1000;

export async function GET() {
  const respond = (body: unknown) => NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  if (!process.env.DB_NAME || !process.env.MONGODB_URI) return respond({ available: false, message: 'Set MONGODB_URI and DB_NAME to load saved listing verdicts.' });
  try {
    const db = await getDb();
    // Read only. Never return listing text, identifiers, photo bytes or seed ring labels.
    // Bound work and response size; no geocoder, writes, streams or new indexes.
    const reports = await db.collection<Report>('reports').find({ status: { $in: ['pending', 'confirmed_scam', 'legit'] } }, { projection: { _id: 1, area: 1, priceEur: 1, status: 1, 'verdict.score': 1, 'verdict.level': 1 } }).sort({ createdAt: -1, _id: -1 }).limit(LIMIT + 1).maxTimeMS(5000).toArray();
    const listings: MapListing[] = [];
    let unscored = 0;
    for (const report of reports.slice(0, LIMIT)) {
      const candidate = { id: String(report._id), area: typeof report.area === 'string' ? report.area : 'Unknown', priceEur: typeof report.priceEur === 'number' && Number.isFinite(report.priceEur) && report.priceEur > 0 ? report.priceEur : null, status: report.status, score: report.verdict?.score, level: report.verdict?.level };
      // Do not infer a score from moderation status or manufacture missing verdicts.
      if (isMapResponse({ available: true, listings: [candidate], unscored: 0, truncated: false, updatedAt: new Date().toISOString() })) listings.push(candidate as MapListing);
      else unscored++;
    }
    return respond({ available: true, listings, unscored, truncated: reports.length > LIMIT, updatedAt: new Date().toISOString() });
  } catch {
    return respond({ available: false, message: 'Saved verdicts could not be loaded. Check the database connection and try again.' });
  }
}
