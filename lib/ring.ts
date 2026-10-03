// Owner: TBD
// STUB. Real version: one $graphLookup over reports.identifiers starting from the report's
// identifiers (maxDepth 2) returning every linked report with its hop count and the
// identifiers it shares with the ring. Returns hashed identifiers only, never raw values.
import { ringFixture } from '@/lib/fixtures';
import type { ReportStatus } from '@/lib/types';

export type RingMember = {
  _id: string;
  area: string;
  priceEur: number | null;
  status: ReportStatus;
  hops: number;
  identifiers: string[];
};

export async function getRing(
  reportId: string,
): Promise<{ members: RingMember[]; sharedIdentifiers: string[] }> {
  void reportId;
  const members: RingMember[] = ringFixture.nodes
    .filter((n) => n.type === 'report')
    .map((n) => ({
      _id: n.id,
      area: n.area ?? '',
      priceEur: n.priceEur ?? null,
      status: n.status as ReportStatus,
      hops: n.hops ?? 0,
      identifiers: ringFixture.links.filter((l) => l.source === n.id).map((l) => l.target),
    }));
  const counts = new Map<string, number>();
  for (const m of members) for (const id of m.identifiers) counts.set(id, (counts.get(id) ?? 0) + 1);
  const sharedIdentifiers = [...counts].filter(([, c]) => c > 1).map(([id]) => id);
  return { members, sharedIdentifiers };
}
