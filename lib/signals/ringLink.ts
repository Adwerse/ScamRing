// Owner: A
// 'ring_link': the report shares identifiers (directly or through other reports) with a
// confirmed scam (45 points), or sits in a cluster of 3+ reports (20 points). Uses getRing.
// Catches its own errors and returns null.
import { getRing, type RingMember } from '@/lib/ring';
import type { Report, Signal } from '@/lib/types';

const CONFIRMED_POINTS = 45;
const CLUSTER_POINTS = 20;
const CLUSTER_MIN_OTHERS = 2;
const KIND_LABELS: Record<string, string> = {
  img: 'photo',
  phone: 'phone number',
  email: 'email address',
  pay: 'payment handle',
  iban: 'bank account',
};

const kindOf = (identifier: string) => identifier.slice(0, identifier.indexOf(':'));

function labels(identifiers: Iterable<string>): string {
  const names = [...new Set([...identifiers].map((id) => KIND_LABELS[kindOf(id)] ?? kindOf(id)))].sort();
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? 'identifier';
}

function shared(a: RingMember, b: RingMember): string[] {
  return a.identifiers.filter((id) => b.identifiers.includes(id));
}

/** Identifiers along a shortest path of shared identifiers from `start` to `target`. */
function pathIdentifiers(members: RingMember[], start: RingMember, target: RingMember): string[] {
  const parent = new Map<string, RingMember>([[start._id, start]]);
  const queue = [start];
  for (let i = 0; i < queue.length && !parent.has(target._id); i++) {
    for (const next of members) {
      if (parent.has(next._id) || shared(queue[i], next).length === 0) continue;
      parent.set(next._id, queue[i]);
      queue.push(next);
    }
  }
  const ids: string[] = [];
  for (let node = target; node._id !== start._id && parent.has(node._id); node = parent.get(node._id)!) {
    ids.push(...shared(node, parent.get(node._id)!));
  }
  return ids;
}

function confirmedSignal(members: RingMember[], self: RingMember, confirmed: RingMember[]): Signal {
  const closest = confirmed.reduce((a, b) => (b.hops < a.hops ? b : a));
  const via = labels(pathIdentifiers(members, self, closest));
  const what = confirmed.length === 1 ? 'a listing confirmed as a scam' : `${confirmed.length} listings confirmed as scams`;
  const lead = closest.hops === 1 ? `Shares the same ${via} with` : `Linked through the same ${via} to`;
  const hops = `${closest.hops} hop${closest.hops === 1 ? '' : 's'}`;
  return {
    code: 'ring_link',
    points: CONFIRMED_POINTS,
    title: 'Linked to a confirmed scam',
    evidence: `${lead} ${what} (${hops}, ${members.length} linked reports).`,
    refs: confirmed.map((m) => m._id),
  };
}

function clusterSignal(others: RingMember[], sharedIdentifiers: string[]): Signal {
  const n = others.length + 1;
  return {
    code: 'ring_link',
    points: CLUSTER_POINTS,
    title: `Part of a cluster of ${n} reports`,
    evidence: `Linked to ${others.length} other reports through the same ${labels(sharedIdentifiers)}; none confirmed as a scam yet.`,
    refs: others.map((m) => m._id),
  };
}

export async function ringLink(report: Report): Promise<Signal | null> {
  try {
    const { members, sharedIdentifiers } = await getRing(report._id.toString());
    const self = members.find((m) => m._id === report._id.toString());
    const others = members.filter((m) => m._id !== report._id.toString());
    if (!self) return null;
    const confirmed = others.filter((m) => m.status === 'confirmed_scam');
    if (confirmed.length > 0) return confirmedSignal(members, self, confirmed);
    return others.length >= CLUSTER_MIN_OTHERS ? clusterSignal(others, sharedIdentifiers) : null;
  } catch (err) {
    console.error('ringLink failed', err);
    return null;
  }
}
