// Owner: B
// Returns a 'text_clone' Signal when the listing's wording is copied from other reported listings.
// Near-duplicate detection on word 3-grams (shingles): the share of the shorter text's 3-grams
// that also appear in the other text, so a listing that reuses half of another one counts too.
// No embeddings, so it is unaffected by the embedding rate limit and needs no vector index.
// Only pending and confirmed reports count: legit listings share ordinary wording.
// Catches its own errors and returns null.
import { getDb } from '@/lib/db';
import type { Report, ReportStatus, Signal } from '@/lib/types';

/** Share of shared 3-word phrases (of the shorter text) at which two listings count as clones. */
export const TEXT_CLONE_THRESHOLD = 0.6;
export const TEXT_CLONE_POINTS = 20;
export const TEXT_CLONE_CONFIRMED_POINTS = 25;
/** Texts with fewer 3-word phrases than this carry too little wording to call a clone. */
export const TEXT_CLONE_MIN_SHINGLES = 10;

const COLLECTION = 'reports';
const SHINGLE_WORDS = 3;
const CANDIDATES = 1000;
const COMPARED_STATUSES: ReportStatus[] = ['pending', 'confirmed_scam'];

type Candidate = Pick<Report, '_id' | 'status' | 'text'>;

type Match = { id: string; status: ReportStatus; overlap: number };

/** Lower-cased word 3-grams; prices and placeholders like [phone] count as words. */
export function shingles(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9€[\]']+/g) ?? [];
  const result = new Set<string>();
  for (let index = 0; index + SHINGLE_WORDS <= words.length; index++) result.add(words.slice(index, index + SHINGLE_WORDS).join(' '));
  return result;
}

/** Share of the smaller set's members that are also in the other set (containment). */
export function overlap(left: Set<string>, right: Set<string>): number {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  if (small.size === 0) return 0;
  let shared = 0;
  for (const shingle of small) if (large.has(shingle)) shared++;
  return shared / small.size;
}

export async function textClone(report: Report): Promise<Signal | null> {
  try {
    const own = shingles(report.text ?? '');
    if (own.size < TEXT_CLONE_MIN_SHINGLES) return null;
    const candidates = await (await getDb())
      .collection<Report>(COLLECTION)
      .find({ _id: { $ne: report._id }, status: { $in: COMPARED_STATUSES } }, { projection: { status: 1, text: 1 } })
      .sort({ createdAt: -1 })
      .limit(CANDIDATES)
      .toArray() as Candidate[];
    const matches: Match[] = candidates
      .map((candidate) => {
        const theirs = shingles(candidate.text ?? '');
        return { id: candidate._id.toString(), status: candidate.status, overlap: theirs.size < TEXT_CLONE_MIN_SHINGLES ? 0 : overlap(own, theirs) };
      })
      .filter((match) => match.overlap >= TEXT_CLONE_THRESHOLD)
      .sort((left, right) => right.overlap - left.overlap);
    if (matches.length === 0) return null;
    const confirmed = matches.filter((match) => match.status === 'confirmed_scam').length;
    const best = Math.round(matches[0].overlap * 100);
    const others = matches.length === 1 ? 'another reported listing' : `${matches.length} other reported listings`;
    const confirmedNote = confirmed > 0 ? `, ${confirmed} of them confirmed scams` : '';
    return {
      code: 'text_clone',
      points: confirmed > 0 ? TEXT_CLONE_CONFIRMED_POINTS : TEXT_CLONE_POINTS,
      title: 'Text copied from other reported listings',
      evidence: `${best}% of the wording matches ${others}${confirmedNote}.`,
      refs: matches.map((match) => match.id),
    };
  } catch (error) {
    console.error('textClone failed', error);
    return null;
  }
}
