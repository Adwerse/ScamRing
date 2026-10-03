// Owner: B
// Generates seed/listings.json: three scam rings (A, B, C) and 150 legit listings.
// Prices come from rent_baseline (run load-rents first), scam scripts from seed/patterns.json.
// Contact details are synthetic and appear raw only in listing text; ingest HMACs them.
// Ring design: A reuses photos p01-p04 and has confirmed scams; B shares one Revolut handle and
// never reuses photos (stays MEDIUM until confirmed); C shares an email and one C listing
// carries ring A's phone, which connects A and C. Legit listings share nothing.
// Usage: npx tsx scripts/gen-seed.ts (import-seed imports verify and reachable from here)
import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFile, writeFile } from 'node:fs/promises';
import { getClient, getDb } from '../lib/db';
import type { RentBaseline, ReportStatus, Source } from '../lib/types';

const OUTPUT_FILE = 'seed/listings.json';
const RENTS_COLLECTION = 'rent_baseline';
const PATTERNS_FILE = 'seed/patterns.json';
const RANDOM_SEED = 20261003;
const LEGIT_COUNT = 150;
/** Hops getRing reaches ($graphLookup maxDepth 2 plus the first hop, see CONTRACT.md); the ring checks use the same depth. */
export const MAX_HOPS = 3;
const ALL_TYPES = 'All property types';
const BEDROOM_BANDS: Record<number, string> = { 1: 'One bed', 2: 'Two bed', 3: 'Three bed' };
/** A room in a shared house rents for roughly this share of a one-bed; priceLow uses the same factor. */
const ROOM_FACTOR = 0.55;
const LEGIT_PRICE_RANGE = [0.9, 1.12];
const SCAM_PRICE_RANGE = [0.4, 0.62];
const SOURCES: Source[] = ['facebook', 'whatsapp', 'telegram', 'daft', 'other'];
const LEGIT_PHOTOS = Array.from({ length: 26 }, (_, index) => photo(index + 15));

type Ring = 'A' | 'B' | 'C';

export type SeedListing = {
  key: string;
  source: Source;
  text: string;
  area: string;
  kind: 'room' | 'whole';
  bedrooms: number | null;
  priceEur: number | null;
  photos: string[];
  seed: true;
  seedRing?: Ring;
  status: ReportStatus;
};

type Area = { location: string; rents: Record<number, number> };

type RingMember = {
  status: ReportStatus;
  contact: string;
  photos: string[];
};

type RingPlan = { ring: Ring; patterns: string[]; members: RingMember[] };

const RING_A_PHONE = '087 412 0193';
const RING_A_PHONE_2 = '085 377 2048';
const RING_A_EMAIL = 'keys.courier.lettings@example.com';
const RING_B_REVOLUT = '@dublinroomsnow';
const RING_C_EMAIL = 'maura.lettings.ie@example.net';

const RING_PLANS: RingPlan[] = [
  {
    ring: 'A',
    patterns: ['owner_abroad_keys_by_post', 'untraceable_payment_method'],
    members: [
      { status: 'confirmed_scam', contact: `Call or text ${RING_A_PHONE}`, photos: [photo(1), photo(2)] },
      { status: 'confirmed_scam', contact: `Email ${RING_A_EMAIL}`, photos: [photo(2), photo(3)] },
      { status: 'pending', contact: `Text ${RING_A_PHONE} or email ${RING_A_EMAIL}`, photos: [photo(1)] },
      { status: 'pending', contact: `WhatsApp ${RING_A_PHONE_2}`, photos: [photo(3), photo(4)] },
      { status: 'pending', contact: `WhatsApp ${RING_A_PHONE_2}`, photos: [photo(4)] },
      { status: 'pending', contact: `Contact ${RING_A_EMAIL}`, photos: [photo(1), photo(4)] },
      { status: 'pending', contact: `Ring ${RING_A_PHONE}`, photos: [photo(2)] },
      { status: 'pending', contact: `Text ${RING_A_PHONE_2}, email ${RING_A_EMAIL}`, photos: [photo(3)] },
    ],
  },
  {
    ring: 'B',
    patterns: ['mass_viewing_multiple_deposits', 'urgency_deposit_before_lease'],
    members: [5, 6, 7, 8, 9, 10].map((number) => ({
      status: 'pending' as ReportStatus,
      contact: `Deposit by Revolut to ${RING_B_REVOLUT}`,
      photos: [photo(number)],
    })),
  },
  {
    ring: 'C',
    patterns: ['sob_story_whatsapp_only', 'id_documents_upfront'],
    members: [
      { status: 'pending', contact: `Email only ${RING_C_EMAIL}`, photos: [photo(11)] },
      { status: 'pending', contact: `Email ${RING_C_EMAIL}`, photos: [photo(12)] },
      { status: 'pending', contact: `Message ${RING_C_EMAIL}`, photos: [photo(13)] },
      { status: 'pending', contact: `Email ${RING_C_EMAIL} or WhatsApp ${RING_A_PHONE}`, photos: [photo(14)] },
      { status: 'pending', contact: `Write to ${RING_C_EMAIL}`, photos: [] },
    ],
  },
];

const LEGIT_OPENERS = [
  'Bright {beds} available in {place}.',
  'Well kept {beds} to let in {place}, available from the 1st.',
  'Spacious {beds} in a quiet development in {place}.',
  'Newly decorated {beds} close to the Luas, {place}.',
  'Comfortable {beds} on a residential road in {place}.',
];
const LEGIT_FEATURES = [
  'Gas central heating, double glazing and a fully fitted kitchen.',
  'Washer dryer, dishwasher and plenty of storage.',
  'Private balcony and allocated parking space.',
  'Walking distance to shops, buses and the park.',
  'Recently renovated bathroom, good broadband.',
  'Furnished, with a south facing garden.',
];
const LEGIT_TERMS = [
  'Viewings by appointment this week. Lease of 12 months, one month deposit, references required.',
  'Registered with the RTB. Viewing essential before any deposit. HAP considered.',
  'Contract and inventory provided. Please bring references to the viewing.',
  'Open viewing Saturday 11am to 12pm. Deposit paid by bank transfer after lease signing.',
];
const LEGIT_ROOM_OPENERS = [
  'Double room in a friendly house share in {place}.',
  'Single room available in {place}, sharing with two professionals.',
  'Large double room with ensuite in {place}.',
];
const RING_VARIATIONS: Record<Ring, string[]> = {
  A: ['Lovely {beds} in {place}, exactly as in the photos.', 'Beautiful {beds} in {place}, just like the pictures.'],
  B: ['{beds} going in {place}, viewing tonight.', 'Great {beds} in {place}, loads of interest already.'],
  C: ['Cosy {beds} in {place}, all bills included.', 'Quiet {beds} in {place}, ideal for students.'],
};

function photo(number: number): string {
  return `p${String(number).padStart(2, '0')}.jpg`;
}

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const next = random(RANDOM_SEED);

function pick<T>(items: T[]): T {
  return items[Math.floor(next() * items.length)];
}

function between([low, high]: number[]): number {
  return low + next() * (high - low);
}

function describeBeds(kind: 'room' | 'whole', bedrooms: number | null): string {
  if (kind === 'room') return 'double room';
  return bedrooms === 3 ? '3-bed house' : `${bedrooms}-bed apartment`;
}

function fill(template: string, kind: 'room' | 'whole', bedrooms: number | null, area: Area): string {
  const text = template.replace('{beds}', describeBeds(kind, bedrooms)).replace('{place}', area.location);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function price(area: Area, kind: 'room' | 'whole', bedrooms: number | null, range: number[]): number {
  const baseline = kind === 'room' ? area.rents[1] * ROOM_FACTOR : area.rents[bedrooms ?? 1];
  return Math.round((baseline * between(range)) / 10) * 10;
}

async function loadAreas(): Promise<Area[]> {
  const database = await getDb();
  const rows = await database
    .collection<RentBaseline>(RENTS_COLLECTION)
    .find({ propertyType: ALL_TYPES, location: /Dublin/, bedrooms: { $in: Object.values(BEDROOM_BANDS) } })
    .toArray();
  const byLocation = new Map<string, Record<number, number>>();
  for (const row of rows) {
    const bedrooms = Number(Object.keys(BEDROOM_BANDS).find((key) => BEDROOM_BANDS[Number(key)] === row.bedrooms));
    byLocation.set(row.location, { ...byLocation.get(row.location), [bedrooms]: row.avgRent });
  }
  const areas = [...byLocation]
    .filter(([, rents]) => rents[1] && rents[2] && rents[3])
    .map(([location, rents]) => ({ location, rents }))
    .sort((left, right) => left.location.localeCompare(right.location));
  if (areas.length === 0) throw new Error(`No Dublin rents with 1, 2 and 3 bed averages in ${database.databaseName}. Run load-rents first.`);
  return areas;
}

function legitContact(index: number): string {
  const phone = `08${pick(['3', '5', '6', '7'])} ${String(100 + index).padStart(3, '0')} ${String(Math.floor(next() * 9000) + 1000)}`;
  return pick([`Call ${phone}`, `Contact the agent on ${phone}`, `Email lettings${index}@example.org`, 'Reply through the listing.']);
}

function buildLegit(areas: Area[]): SeedListing[] {
  return Array.from({ length: LEGIT_COUNT }, (_, index) => {
    const area = pick(areas);
    const kind: 'room' | 'whole' = next() < 0.3 ? 'room' : 'whole';
    const bedrooms = kind === 'room' ? null : pick([1, 1, 2, 2, 3]);
    const opener = fill(pick(kind === 'room' ? LEGIT_ROOM_OPENERS : LEGIT_OPENERS), kind, bedrooms, area);
    const priceEur = price(area, kind, bedrooms, LEGIT_PRICE_RANGE);
    const text = [opener, pick(LEGIT_FEATURES), `€${priceEur} per month.`, pick(LEGIT_TERMS), legitContact(index)].join(' ');
    return {
      key: `L${String(index + 1).padStart(3, '0')}`,
      source: pick(SOURCES),
      text,
      area: area.location,
      kind,
      bedrooms,
      priceEur,
      photos: index < LEGIT_PHOTOS.length ? [LEGIT_PHOTOS[index]] : [],
      seed: true,
      status: 'legit',
    };
  });
}

function buildRings(areas: Area[], scripts: Map<string, string>): SeedListing[] {
  return RING_PLANS.flatMap(({ ring, patterns, members }) =>
    members.map((member, index) => {
      const area = pick(areas);
      const kind: 'room' | 'whole' = ring === 'B' ? 'room' : 'whole';
      const bedrooms = kind === 'room' ? null : pick([1, 2]);
      const priceEur = price(area, kind, bedrooms, SCAM_PRICE_RANGE);
      const script = patterns.map((code) => scripts.get(code)).join(' ');
      const opener = fill(RING_VARIATIONS[ring][index % 2], kind, bedrooms, area);
      return {
        key: `${ring}${index + 1}`,
        source: pick(SOURCES),
        text: `${opener} €${priceEur} per month. ${script} ${member.contact}`,
        area: area.location,
        kind,
        bedrooms,
        priceEur,
        photos: member.photos,
        seed: true as const,
        seedRing: ring,
        status: member.status,
      };
    }),
  );
}

function linkKeys(listing: SeedListing): string[] {
  const contacts = listing.text.match(/\b08\d \d{3} \d{4}\b|[\w.]+@example\.(?:com|net|org)|@\w+(?=\s|$)/g) ?? [];
  return [...contacts, ...listing.photos];
}

/**
 * Keys of every listing reachable from `fromKey` through shared raw contacts or photos, with
 * hop counts, up to `maxHops` (unlimited by default). Mirrors what getRing sees after ingest.
 */
export function reachable(listings: SeedListing[], fromKey: string, maxHops = Infinity): Map<string, number> {
  const byLink = new Map<string, SeedListing[]>();
  for (const listing of listings) {
    for (const key of linkKeys(listing)) byLink.set(key, [...(byLink.get(key) ?? []), listing]);
  }
  const hops = new Map([[fromKey, 0]]);
  let frontier = listings.filter((listing) => listing.key === fromKey);
  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
    const next: SeedListing[] = [];
    for (const listing of frontier) {
      for (const neighbour of linkKeys(listing).flatMap((key) => byLink.get(key) ?? [])) {
        if (hops.has(neighbour.key)) continue;
        hops.set(neighbour.key, hop);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return hops;
}

function keysOf(listings: SeedListing[], ...rings: (Ring | undefined)[]): string[] {
  return listings.filter((listing) => rings.includes(listing.seedRing)).map((listing) => listing.key).sort();
}

function sameKeys(actual: Iterable<string>, expected: string[]): boolean {
  const sorted = [...actual].sort();
  return sorted.length === expected.length && sorted.every((key, index) => key === expected[index]);
}

/** Throws unless every ring is complete and legit listings link to nothing. */
export function verify(listings: SeedListing[]): void {
  const failures: string[] = [];
  const ringAC = keysOf(listings, 'A', 'C');
  const ringB = keysOf(listings, 'B');
  if (!sameKeys(reachable(listings, ringAC[0]).keys(), ringAC)) failures.push('A and C do not form exactly one linked group');
  if (!sameKeys(reachable(listings, ringB[0]).keys(), ringB)) failures.push('B does not form exactly one linked group');
  for (const key of keysOf(listings, undefined)) {
    if (reachable(listings, key).size > 1) failures.push(`legit listing ${key} links to another listing`);
  }
  for (const ring of ['A', 'B', 'C'] as const) {
    const members = keysOf(listings, ring);
    const near = [...reachable(listings, members[0], MAX_HOPS).keys()];
    const missing = members.filter((key) => !near.includes(key));
    if (missing.length > 0) failures.push(`ring ${ring}: ${missing.join(', ')} not within ${MAX_HOPS} hops of ${members[0]}`);
  }
  if (failures.length > 0) throw new Error(`Ring check failed:\n- ${failures.join('\n- ')}`);
  console.log(`Ring check: A and C form one group, B is separate, every ring is complete within ${MAX_HOPS} hops, no legit listing links to anything`);
}

function summarise(listings: SeedListing[], areas: Area[]): void {
  const baseline = (listing: SeedListing) => {
    const area = areas.find((candidate) => candidate.location === listing.area)!;
    return listing.kind === 'room' ? area.rents[1] * ROOM_FACTOR : area.rents[listing.bedrooms ?? 1];
  };
  const groups = Map.groupBy(listings, (listing) => listing.seedRing ?? 'legit');
  console.table(
    [...groups].map(([group, members]) => ({
      group,
      listings: members.length,
      confirmed: members.filter((listing) => listing.status === 'confirmed_scam').length,
      withPhotos: members.filter((listing) => listing.photos.length > 0).length,
      averagePriceVsMarket: `${Math.round((100 * members.reduce((sum, listing) => sum + listing.priceEur! / baseline(listing), 0)) / members.length)}%`,
    })),
  );
}

async function main(): Promise<void> {
  const patterns = JSON.parse(await readFile(PATTERNS_FILE, 'utf8')) as { code: string; text: string }[];
  const scripts = new Map(patterns.map((pattern) => [pattern.code, pattern.text]));
  const areas = await loadAreas();
  const listings = [...buildRings(areas, scripts), ...buildLegit(areas)];
  verify(listings);
  summarise(listings, areas);
  await writeFile(OUTPUT_FILE, `${JSON.stringify(listings, null, 2)}\n`);
  console.log(`Wrote ${listings.length} listings across ${areas.length} Dublin areas to ${OUTPUT_FILE}`);
  await (await getClient()).close();
}

if (process.argv[1]?.endsWith('gen-seed.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
