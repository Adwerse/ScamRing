// Owner: B
// Returns a 'price_low' Signal when priceEur is far below the RTB average rent (rent_baseline,
// CSO RIQ02) for the area and bedrooms. Areas match exactly ("Portobello, Dublin 8"), by postal
// district ("Dublin 8" averages every "…, Dublin 8" location), or by county ("Dublin"); the
// listing's bedroom band is tried at every scope before the all-bedroom average, and the
// evidence names the average used. Rooms are compared with ROOM_FACTOR times the one-bed average.
// Catches its own errors and returns null.
import { getDb } from '@/lib/db';
import type { RentBaseline, Report, Signal } from '@/lib/types';

/** Flag a listing priced at least this far below market (0.35 = 35% lower). */
export const PRICE_LOW_THRESHOLD = 0.35;
/** Below this share of market the signal counts as severe. */
export const PRICE_SEVERE_THRESHOLD = 0.5;
export const PRICE_LOW_POINTS = 15;
export const PRICE_SEVERE_POINTS = 25;
/** A room in a shared house rents for roughly this share of a one-bed (same factor as gen-seed). */
export const ROOM_FACTOR = 0.55;

const COLLECTION = 'rent_baseline';
const ALL_TYPES = 'All property types';
const ALL_BEDROOMS = 'All bedrooms';
const BEDROOM_BANDS: Record<number, string> = { 1: 'One bed', 2: 'Two bed', 3: 'Three bed' };
const FOUR_PLUS = 'Four plus bed';
const BAND_LABELS: Record<string, string> = {
  [ALL_BEDROOMS]: 'all-bedroom',
  [BEDROOM_BANDS[1]]: '1-bed',
  [BEDROOM_BANDS[2]]: '2-bed',
  [BEDROOM_BANDS[3]]: '3-bed',
  [FOUR_PLUS]: '4+ bed',
};

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type Scope = { label: string; location: RegExp };

type Baseline = { rent: number; band: string; scope: string };

function band(report: Report): string {
  if (report.kind === 'room') return BEDROOM_BANDS[1];
  if (report.bedrooms === null) return ALL_BEDROOMS;
  return BEDROOM_BANDS[report.bedrooms] ?? FOUR_PLUS;
}

/** Narrowest first: the exact location, its postal district, then its county. */
function scopes(area: string): Scope[] {
  const name = area.trim();
  const district = name.includes(',') ? name.slice(name.lastIndexOf(',') + 1).trim() : name;
  const county = district.replace(/\s+\d+\w?$/, '');
  const candidates: Scope[] = [
    { label: name, location: new RegExp(`^${escape(name)}$`, 'i') },
    { label: `${district} areas`, location: new RegExp(`, ${escape(district)}$`, 'i') },
    { label: `${county} overall`, location: new RegExp(`^${escape(county)}$`, 'i') },
  ];
  return candidates.filter(
    (scope, index) => candidates.findIndex((other) => other.location.source === scope.location.source) === index,
  );
}

/** Prefers the listing's own bedroom band at any scope before falling back to the all-bedroom average. */
async function baseline(report: Report): Promise<Baseline | null> {
  const database = await getDb();
  const wanted = band(report);
  // A room is only ever compared with a one-bed: an all-bedroom average would overstate its market.
  const bands = wanted === ALL_BEDROOMS || report.kind === 'room' ? [wanted] : [wanted, ALL_BEDROOMS];
  for (const bedroomBand of bands) {
    for (const scope of scopes(report.area)) {
      const [result] = await database
        .collection<RentBaseline>(COLLECTION)
        .aggregate<{ rent: number }>([
          { $match: { location: scope.location, propertyType: ALL_TYPES, bedrooms: bedroomBand } },
          { $group: { _id: null, rent: { $avg: '$avgRent' } } },
        ])
        .toArray();
      if (result) return { rent: result.rent, band: bedroomBand, scope: scope.label };
    }
  }
  return null;
}

function describe(report: Report): string {
  if (report.kind === 'room') return 'a room';
  return report.bedrooms ? `a ${report.bedrooms}-bed` : 'a property';
}

function describeAverage(report: Report, found: Baseline): string {
  const average = `RTB ${BAND_LABELS[found.band] ?? found.band} average for ${found.scope}`;
  return report.kind === 'room' ? `${Math.round(ROOM_FACTOR * 100)}% of the ${average}` : `the ${average}`;
}

export async function priceLow(report: Report): Promise<Signal | null> {
  try {
    if (!report.priceEur || !report.area) return null;
    const found = await baseline(report);
    if (!found) return null;
    const market = report.kind === 'room' ? found.rent * ROOM_FACTOR : found.rent;
    const ratio = report.priceEur / market;
    if (ratio > 1 - PRICE_LOW_THRESHOLD) return null;
    const lower = Math.round((1 - ratio) * 100);
    const euro = (value: number) => `€${Math.round(value).toLocaleString('en-IE')}`;
    return {
      code: 'price_low',
      points: ratio < PRICE_SEVERE_THRESHOLD ? PRICE_SEVERE_POINTS : PRICE_LOW_POINTS,
      title: 'Price far below market',
      evidence: `${euro(report.priceEur)}/month for ${describe(report)} in ${report.area}; ${describeAverage(report, found)} is ${euro(market)} (${lower}% lower).`,
      refs: [],
    };
  } catch (error) {
    console.error('priceLow failed', error);
    return null;
  }
}
