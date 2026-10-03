// Owner: B
// Returns a 'script_match' Signal when the listing text follows a known scam script.
// First Atlas Vector Search over scam_patterns (index patterns_vec, automated embedding), then a
// keyword fallback over seed/patterns.json for sandboxes without the index or when the vector
// match is weak. Scripts are real (Garda, CCPC, Daft and bank warnings; seed/patterns-sources.md).
// Catches its own errors and returns null.
import { getDb } from '@/lib/db';
import patterns from '@/seed/patterns.json';
import type { Report, ScamPattern, Signal } from '@/lib/types';
import { vectorSearchStage } from '@/lib/vector';

/** Vector search score at or above which the listing counts as following a script. */
export const SCRIPT_THRESHOLD = 0.88;
/** Vector search score at which the match counts as strong. */
export const SCRIPT_STRONG_THRESHOLD = 0.93;

/** Distinct keywords of one pattern a listing must contain to count as a match. */
export const SCRIPT_KEYWORD_MIN_HITS = 2;
/** Keyword hits at which the match counts as strong. */
export const SCRIPT_KEYWORD_STRONG_HITS = 4;
export const SCRIPT_POINTS = 10;
export const SCRIPT_STRONG_POINTS = 20;

const STOPWORDS = new Set(['a', 'an', 'the', 'to', 'of', 'on', 'my', 'your', 'you', 'is', 'and', 'or', 'by', 'me', 'it']);
/** Words that turn a following keyword into a warning ("never pay by crypto") rather than an instruction. */
const NEGATIONS = new Set(['never', 'not', "don't", 'dont', 'no', 'avoid', "won't", "doesn't", 'without', 'refuse']);
/** Extra words allowed between the words of one keyword ("post the keys" matches "post your keys"). */
const MAX_GAP = 2;
/** How far back a negation reaches, within the same sentence. */
const NEGATION_REACH = 5;

const INDEX = 'patterns_vec';
const COLLECTION = 'scam_patterns';

type PatternMatch = { title: string; hits: string[] };

type VectorMatch = { title: string; score: number };

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z0-9'€.!?;]+/)
    .flatMap((word) => (/[.!?;]$/.test(word) ? [word.replace(/[.!?;]+$/, ''), '.'] : [word]))
    .filter(Boolean);
}

function negated(listing: string[], start: number): boolean {
  for (let index = start - 1; index >= Math.max(0, start - NEGATION_REACH); index--) {
    if (listing[index] === '.' || listing[index] === 'but') return false;
    if (NEGATIONS.has(listing[index])) return true;
  }
  return false;
}

/** A keyword hits when its meaningful words appear in order, close together, and not negated. */
function contains(listing: string[], keyword: string): boolean {
  const required = words(keyword).filter((word) => !STOPWORDS.has(word));
  if (required.length === 0) return false;
  for (let start = 0; start < listing.length; start++) {
    if (listing[start] !== required[0]) continue;
    let position = start;
    const matched = required.slice(1).every((word) => {
      const found = listing.slice(position + 1, position + 2 + MAX_GAP).indexOf(word);
      if (found === -1) return false;
      position += found + 1;
      return true;
    });
    if (matched && !negated(listing, start)) return true;
  }
  return false;
}

function bestKeywordMatch(text: string): PatternMatch | null {
  const listing = words(text);
  let best: PatternMatch | null = null;
  for (const pattern of patterns) {
    const hits = pattern.keywords.filter((keyword) => contains(listing, keyword));
    if (hits.length >= SCRIPT_KEYWORD_MIN_HITS && hits.length > (best?.hits.length ?? 0)) {
      best = { title: pattern.title, hits };
    }
  }
  return best;
}

async function bestVectorMatch(text: string): Promise<VectorMatch | null> {
  try {
    const database = await getDb();
    const [best] = await database
      .collection<ScamPattern>(COLLECTION)
      .aggregate<VectorMatch>([
        vectorSearchStage({ index: INDEX, path: 'text', text, limit: 1 }),
        { $project: { _id: 0, title: 1, score: { $meta: 'vectorSearchScore' } } },
      ])
      .toArray();
    return best && best.score >= SCRIPT_THRESHOLD ? best : null;
  } catch {
    // No vector index (sandbox) or search unavailable: the keyword fallback decides.
    return null;
  }
}

export async function scriptMatch(report: Report): Promise<Signal | null> {
  try {
    if (!report.text) return null;
    const vector = await bestVectorMatch(report.text);
    if (vector) {
      return {
        code: 'script_match',
        points: vector.score >= SCRIPT_STRONG_THRESHOLD ? SCRIPT_STRONG_POINTS : SCRIPT_POINTS,
        title: 'Matches a known scam script',
        evidence: `Reads like the "${vector.title}" script (${Math.round(vector.score * 100)}% similar).`,
        refs: [],
      };
    }
    const match = bestKeywordMatch(report.text);
    if (!match) return null;
    const quoted = match.hits.slice(0, 3).map((hit) => `"${hit}"`).join(', ');
    return {
      code: 'script_match',
      points: match.hits.length >= SCRIPT_KEYWORD_STRONG_HITS ? SCRIPT_STRONG_POINTS : SCRIPT_POINTS,
      title: 'Matches a known scam script',
      evidence: `Follows the "${match.title}" script (mentions ${quoted}).`,
      refs: [],
    };
  } catch (error) {
    console.error('scriptMatch failed', error);
    return null;
  }
}
