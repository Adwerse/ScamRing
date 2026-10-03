// Owner: A
// The ring of a report: every non-rejected report reachable through shared identifiers
// (phone/email/pay/iban hashes and 'img:<clusterId>'), found with one $graphLookup that walks
// the identifiers_1 multikey index. hops = 0 for the report itself, 1 for reports sharing an
// identifier with it, 2 for reports sharing one with those, and so on.
// Returns hashed identifiers only, never raw values.
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import type { Report, ReportStatus } from '@/lib/types';

export type RingMember = {
  _id: string;
  area: string;
  priceEur: number | null;
  status: ReportStatus;
  hops: number;
  identifiers: string[];
};

/** $graphLookup depth starts at 0 for reports sharing an identifier with the start, so hops = depth + 1. */
const MAX_DEPTH = 2;
const MAX_MEMBERS = 60;

type Hit = Report & { hops: number };

function memberOf(report: Report, hops: number): RingMember {
  return {
    _id: report._id.toString(),
    area: report.area,
    priceEur: report.priceEur,
    status: report.status,
    hops,
    identifiers: report.identifiers,
  };
}

function sharedIdentifiers(members: RingMember[]): string[] {
  const counts = new Map<string, number>();
  for (const m of members) for (const id of m.identifiers) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].filter(([, count]) => count >= 2).map(([id]) => id);
}

export async function getRing(
  reportId: string,
): Promise<{ members: RingMember[]; sharedIdentifiers: string[] }> {
  if (!/^[0-9a-f]{24}$/i.test(reportId)) return { members: [], sharedIdentifiers: [] };
  const _id = new ObjectId(reportId);
  const db = await getDb();
  const [start] = await db
    .collection<Report>('reports')
    .aggregate<Report & { ring: Hit[] }>([
      { $match: { _id } },
      {
        $graphLookup: {
          from: 'reports',
          startWith: '$identifiers',
          connectFromField: 'identifiers',
          connectToField: 'identifiers',
          as: 'ring',
          maxDepth: MAX_DEPTH,
          depthField: 'hops',
          restrictSearchWithMatch: { status: { $ne: 'rejected' } },
        },
      },
    ])
    .toArray();
  if (!start) return { members: [], sharedIdentifiers: [] };

  const others = start.ring
    .filter((r) => !r._id.equals(_id))
    .map((r) => memberOf(r, r.hops + 1))
    .sort((a, b) => a.hops - b.hops || a._id.localeCompare(b._id));
  const members = [memberOf(start, 0), ...others].slice(0, MAX_MEMBERS);
  return { members, sharedIdentifiers: sharedIdentifiers(members) };
}
