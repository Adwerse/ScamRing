// Owner: B
// GET /api/reports/[id]/ring: the graph of reports linked to this one through shared hashed
// identifiers, in exactly the shape of fixtures/ring.json. Identifier node ids are the hashed
// 'kind:value' strings; hints are the masked identifierHints, and img hints are photo URLs.
import { ObjectId } from 'mongodb';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getRing } from '@/lib/ring';
import type { IdentifierHint, Photo, Report, ReportStatus } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Kind = IdentifierHint['kind'];

type ReportNode = {
  id: string;
  type: 'report';
  area: string;
  priceEur: number | null;
  status: ReportStatus;
  hops: number;
  isCurrent: boolean;
};

type IdentifierNode = { id: string; type: 'identifier'; kind: Kind; hint: string };

type Link = { source: string; target: string; kind: Kind };

type RingReport = Pick<Report, '_id' | 'area' | 'priceEur' | 'status' | 'identifiers' | 'identifierHints'>;

const IMG = 'img';
const PROJECTION = { area: 1, priceEur: 1, status: 1, identifiers: 1, identifierHints: 1 } as const;

function kindOf(identifier: string): Kind {
  return identifier.slice(0, identifier.indexOf(':')) as Kind;
}

/**
 * Masked hint for each non-image identifier of a report. A hint carrying its identifier id is
 * used directly; otherwise hints are paired with identifiers of the same kind in order, which
 * relies on ingest writing both lists in the same order.
 */
function hintsOf(report: RingReport): Map<string, string> {
  const hints = new Map<string, string>();
  const byKind = new Map<Kind, string[]>();
  for (const hint of report.identifierHints ?? []) {
    const id = (hint as IdentifierHint & { id?: string }).id;
    if (id) hints.set(id, hint.hint);
    else byKind.set(hint.kind, [...(byKind.get(hint.kind) ?? []), hint.hint]);
  }
  for (const identifier of report.identifiers ?? []) {
    const kind = kindOf(identifier);
    if (kind === IMG || hints.has(identifier)) continue;
    const next = byKind.get(kind)?.shift();
    if (next) hints.set(identifier, next);
  }
  return hints;
}

async function photoUrls(clusterIds: string[]): Promise<Map<string, string>> {
  if (clusterIds.length === 0) return new Map();
  const database = await getDb();
  const photos = await database
    .collection<Photo>('photos')
    .aggregate<{ _id: string; photoId: ObjectId }>([
      { $match: { clusterId: { $in: clusterIds } } },
      { $sort: { createdAt: 1 } },
      { $group: { _id: '$clusterId', photoId: { $first: '$_id' } } },
    ])
    .toArray();
  return new Map(photos.map((photo) => [`${IMG}:${photo._id}`, `/api/photos/${photo.photoId.toString()}`]));
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  const database = await getDb();
  const reports = database.collection<Report>('reports');
  const current = await reports.findOne<RingReport>({ _id: new ObjectId(id) }, { projection: PROJECTION });
  if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { members } = await getRing(id);
  const hops = new Map(members.map((member) => [member._id, member.hops]));
  hops.set(id, 0);
  const memberIds = [...hops.keys()].filter((memberId) => memberId !== id && ObjectId.isValid(memberId));
  const others = await reports
    .find<RingReport>({ _id: { $in: memberIds.map((memberId) => new ObjectId(memberId)) } }, { projection: PROJECTION })
    .toArray();
  const ring = [current, ...others];

  const owners = new Map<string, number>();
  for (const report of ring) for (const identifier of new Set(report.identifiers)) owners.set(identifier, (owners.get(identifier) ?? 0) + 1);
  const shared = new Set([...owners].filter(([, count]) => count > 1).map(([identifier]) => identifier));

  const hints = new Map(ring.flatMap((report) => [...hintsOf(report)]));
  const images = await photoUrls([...shared].filter((identifier) => kindOf(identifier) === IMG).map((identifier) => identifier.slice(IMG.length + 1)));

  const reportNodes: ReportNode[] = ring.map((report) => ({
    id: report._id.toString(),
    type: 'report',
    area: report.area,
    priceEur: report.priceEur,
    status: report.status,
    hops: hops.get(report._id.toString()) ?? 0,
    isCurrent: report._id.toString() === id,
  }));
  const identifierNodes: IdentifierNode[] = [...shared].map((identifier) => ({
    id: identifier,
    type: 'identifier',
    kind: kindOf(identifier),
    hint: (kindOf(identifier) === IMG ? images.get(identifier) : hints.get(identifier)) ?? '',
  }));
  const links: Link[] = ring.flatMap((report) =>
    [...new Set(report.identifiers)]
      .filter((identifier) => shared.has(identifier))
      .map((identifier) => ({ source: report._id.toString(), target: identifier, kind: kindOf(identifier) })),
  );

  return NextResponse.json({
    nodes: [...reportNodes, ...identifierNodes],
    links,
    stats: {
      reports: reportNodes.length,
      confirmed: reportNodes.filter((node) => node.status === 'confirmed_scam').length,
      maxHops: Math.max(0, ...reportNodes.map((node) => node.hops)),
    },
  });
}
