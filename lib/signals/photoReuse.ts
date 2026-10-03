// Owner: A
// 'photo_reuse' (35 points): a photo of this report (identifier 'img:<clusterId>') is also used
// by other reports in a different area, or at a price that differs by more than PRICE_DIFF.
// Catches its own errors and returns null.
import { getDb } from '@/lib/db';
import type { Report, Signal } from '@/lib/types';

const POINTS = 35;
/** Relative price difference, |a - b| / max(a, b), above which two listings of one photo differ. */
const PRICE_DIFF = 0.15;

type Other = Pick<Report, '_id' | 'area' | 'priceEur'>;

const sameArea = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function priceDiffers(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) / Math.max(a, b) > PRICE_DIFF;
}

function describe(others: Other[]): string {
  const areas = [...new Set(others.map((o) => o.area))].sort();
  const prices = [...new Set(others.flatMap((o) => (o.priceEur === null ? [] : [o.priceEur])))].sort((a, b) => a - b);
  const parts = [`areas ${areas.join(', ')}`];
  if (prices.length > 0) parts.push(`prices ${prices.map((p) => `€${p}`).join(', ')}`);
  return `Same photo used in ${others.length} other listing${others.length === 1 ? '' : 's'} (${parts.join('; ')})`;
}

export async function photoReuse(report: Report): Promise<Signal | null> {
  try {
    const images = report.identifiers.filter((id) => id.startsWith('img:'));
    if (images.length === 0) return null;
    const db = await getDb();
    const others = await db
      .collection<Report>('reports')
      .find(
        { identifiers: { $in: images }, _id: { $ne: report._id }, status: { $ne: 'rejected' } },
        { projection: { area: 1, priceEur: 1 } },
      )
      .toArray();
    const differing = others.filter((o) => !sameArea(o.area, report.area) || priceDiffers(o.priceEur, report.priceEur));
    if (differing.length === 0) return null;
    return {
      code: 'photo_reuse',
      points: POINTS,
      title: 'Same photo in other listings',
      evidence: `${describe(differing)}.`,
      refs: differing.map((o) => o._id.toString()),
    };
  } catch (err) {
    console.error('photoReuse failed', err);
    return null;
  }
}
