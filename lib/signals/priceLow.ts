// Owner: B
// Returns a 'price_low' Signal when priceEur is far below the RTB average rent (rent_baseline,
// CSO RIQ02) for the area and bedrooms. Areas match exactly ("Portobello, Dublin 8"), by postal
// district ("Dublin 8" averages every "…, Dublin 8" location), or by county ("Dublin").
// Rooms are compared with ROOM_FACTOR times the one-bed average.
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

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function band(report: Report): string {
  if (report.kind === 'room') return BEDROOM_BANDS[1];
  if (report.bedrooms === null) return ALL_BEDROOMS;
  return BEDROOM_BANDS[report.bedrooms] ?? FOUR_PLUS;
}

async function averageRent(area: string, bedrooms: string): Promise<number | null> {
  const database = await getDb();
  const name = area.trim();
  const candidates = [
    { location: new RegExp(`^${escape(name)}$`, 'i') },
    { location: new RegExp(`, ${escape(name)}$`, 'i') },
  ];
  for (const location of candidates) {
    for (const bedroomBand of [bedrooms, ALL_BEDROOMS]) {
      const [result] = await database
        .collection<RentBaseline>(COLLECTION)
        .aggregate<{ rent: number }>([
          { $match: { ...location, propertyType: ALL_TYPES, bedrooms: bedroomBand } },
          { $group: { _id: null, rent: { $avg: '$avgRent' } } },
        ])
        .toArray();
      if (result) return result.rent;
    }
  }
  return null;
}

function describe(report: Report): string {
  if (report.kind === 'room') return 'a room';
  return report.bedrooms ? `a ${report.bedrooms}-bed` : 'a property';
}

export async function priceLow(report: Report): Promise<Signal | null> {
  try {
    if (!report.priceEur || !report.area) return null;
    const baseline = await averageRent(report.area, band(report));
    if (!baseline) return null;
    const market = report.kind === 'room' ? baseline * ROOM_FACTOR : baseline;
    const ratio = report.priceEur / market;
    if (ratio > 1 - PRICE_LOW_THRESHOLD) return null;
    const lower = Math.round((1 - ratio) * 100);
    const euro = (value: number) => `€${Math.round(value).toLocaleString('en-IE')}`;
    return {
      code: 'price_low',
      points: ratio < PRICE_SEVERE_THRESHOLD ? PRICE_SEVERE_POINTS : PRICE_LOW_POINTS,
      title: 'Price far below market',
      evidence: `${euro(report.priceEur)}/month for ${describe(report)} in ${report.area}; the RTB average is ${euro(market)} (${lower}% lower).`,
      refs: [],
    };
  } catch (error) {
    console.error('priceLow failed', error);
    return null;
  }
}
