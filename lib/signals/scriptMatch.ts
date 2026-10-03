// Owner: B
// Returns a 'script_match' Signal when the listing text follows a known scam script.
// Today: keyword fallback over seed/patterns.json (real scripts from Garda, CCPC, Daft and bank
// warnings; sources in seed/patterns-sources.md). Atlas Vector Search on scam_patterns joins
// once lane A's vector index lands; the keyword match stays as its fallback.
// Catches its own errors and returns null.
import patterns from '@/seed/patterns.json';
import type { Report, Signal } from '@/lib/types';

/** Distinct keywords of one pattern a listing must contain to count as a match. */
export const SCRIPT_KEYWORD_MIN_HITS = 2;
/** Keyword hits at which the match counts as strong. */
export const SCRIPT_KEYWORD_STRONG_HITS = 4;
export const SCRIPT_POINTS = 10;
export const SCRIPT_STRONG_POINTS = 20;

const STOPWORDS = new Set(['a', 'an', 'the', 'to', 'of', 'on', 'my', 'your', 'you', 'is', 'and', 'or', 'by', 'me', 'it']);

type PatternMatch = { title: string; hits: string[] };

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z0-9'€]+/)
    .filter(Boolean);
}

/** A keyword hits when every one of its meaningful words appears somewhere in the listing. */
function contains(listing: Set<string>, keyword: string): boolean {
  const required = words(keyword).filter((word) => !STOPWORDS.has(word));
  return required.length > 0 && required.every((word) => listing.has(word));
}

function bestKeywordMatch(text: string): PatternMatch | null {
  const listing = new Set(words(text));
  let best: PatternMatch | null = null;
  for (const pattern of patterns) {
    const hits = pattern.keywords.filter((keyword) => contains(listing, keyword));
    if (hits.length >= SCRIPT_KEYWORD_MIN_HITS && hits.length > (best?.hits.length ?? 0)) {
      best = { title: pattern.title, hits };
    }
  }
  return best;
}

export async function scriptMatch(report: Report): Promise<Signal | null> {
  try {
    if (!report.text) return null;
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
