// Owner: B
// Returns a 'text_clone' Signal when the listing text is a near-duplicate of other reported
// listings (Atlas Vector Search, index reports_text_vec, automated embedding of `text`).
// Only pending and confirmed reports count: legit listings share ordinary wording, and comparing
// against them would flag every normal post.
// Catches its own errors and returns null.
import { getDb } from '@/lib/db';
import type { Report, ReportStatus, Signal } from '@/lib/types';
import { vectorSearchStage } from '@/lib/vector';

/** Vector search score at or above which two listings count as clones. */
export const TEXT_CLONE_THRESHOLD = 0.92;
export const TEXT_CLONE_POINTS = 20;
export const TEXT_CLONE_CONFIRMED_POINTS = 25;
/** Texts shorter than this carry too little wording to call a clone. */
export const TEXT_CLONE_MIN_LENGTH = 60;

const INDEX = 'reports_text_vec';
const COLLECTION = 'reports';
const CANDIDATES = 10;
const COMPARED_STATUSES: ReportStatus[] = ['pending', 'confirmed_scam'];

type Match = { _id: Report['_id']; status: ReportStatus; score: number };

export async function textClone(report: Report): Promise<Signal | null> {
  try {
    if (!report.text || report.text.length < TEXT_CLONE_MIN_LENGTH) return null;
    const database = await getDb();
    const matches = await database
      .collection<Report>(COLLECTION)
      .aggregate<Match>([
        vectorSearchStage({
          index: INDEX,
          path: 'text',
          text: report.text,
          limit: CANDIDATES,
          filter: { status: { $in: COMPARED_STATUSES } },
        }),
        { $project: { status: 1, score: { $meta: 'vectorSearchScore' } } },
        { $match: { _id: { $ne: report._id }, score: { $gte: TEXT_CLONE_THRESHOLD } } },
      ])
      .toArray();
    if (matches.length === 0) return null;
    const confirmed = matches.filter((match) => match.status === 'confirmed_scam').length;
    const best = Math.round(Math.max(...matches.map((match) => match.score)) * 100);
    const others = matches.length === 1 ? 'another reported listing' : `${matches.length} other reported listings`;
    const confirmedNote = confirmed > 0 ? `, ${confirmed} of them confirmed scams` : '';
    return {
      code: 'text_clone',
      points: confirmed > 0 ? TEXT_CLONE_CONFIRMED_POINTS : TEXT_CLONE_POINTS,
      title: 'Text copied from other reported listings',
      evidence: `The wording is a near copy of ${others} (best match ${best}% similar${confirmedNote}).`,
      refs: matches.map((match) => match._id.toString()),
    };
  } catch (error) {
    console.error('textClone failed', error);
    return null;
  }
}
