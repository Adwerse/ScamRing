// Owner: B
// Resets the report data and imports seed/listings.json through A's ingestReport, then prints
// the ring check (getRing from one member of each ring) and the verdict calibration table.
// Usage: npx tsx scripts/import-seed.ts [--shared]
import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFile } from 'node:fs/promises';
import { getClient, getDb } from '../lib/db';
import { ingestReport } from '../lib/ingest';
import { getRing } from '../lib/ring';
import { computeVerdict } from '../lib/verdict';
import type { Verdict } from '../lib/types';
import type { SeedListing } from './gen-seed';

const SHARED_DB = 'scamring';
const SHARED_FLAG = '--shared';
const LISTINGS_FILE = 'seed/listings.json';
const PHOTOS_DIRECTORY = 'seed/photos';
const PHOTOS_MODULE = '../lib/photos';
const BATCH_SIZE = 5;
const RESET_COLLECTIONS = ['reports', 'photos', 'photos_blob', 'checks', 'alerts', 'moderation_events'];
const LEVELS: Verdict['level'][] = ['LOW', 'MEDIUM', 'HIGH'];
const LEGIT = 'legit';

function refuseSharedWithoutFlag(): void {
  const database = process.env.DB_NAME || SHARED_DB;
  if (database === SHARED_DB && !process.argv.includes(SHARED_FLAG)) {
    console.error(`Refusing to reset the shared database "${SHARED_DB}". Post RESETTING SHARED DB in 2 min, then re-run with ${SHARED_FLAG}.`);
    process.exit(1);
  }
}

async function readPhotos(names: string[], missing: Set<string>): Promise<Buffer[]> {
  const photos: Buffer[] = [];
  for (const name of names) {
    try {
      photos.push(await readFile(`${PHOTOS_DIRECTORY}/${name}`));
    } catch {
      missing.add(name);
    }
  }
  return photos;
}

async function importListings(listings: SeedListing[]): Promise<Map<string, SeedListing>> {
  const byId = new Map<string, SeedListing>();
  const missing = new Set<string>();
  for (let start = 0; start < listings.length; start += BATCH_SIZE) {
    await Promise.all(
      listings.slice(start, start + BATCH_SIZE).map(async ({ key, photos, ...listing }) => {
        const report = await ingestReport({ ...listing, photos: await readPhotos(photos, missing) });
        byId.set(report._id.toString(), { key, photos, ...listing });
      }),
    );
    process.stdout.write(`\rIngested ${Math.min(start + BATCH_SIZE, listings.length)}/${listings.length}`);
  }
  process.stdout.write('\n');
  if (missing.size > 0) console.warn(`${missing.size} photos missing from ${PHOTOS_DIRECTORY} (C pushes them); imported without them`);
  return byId;
}

async function printRingCheck(byId: Map<string, SeedListing>): Promise<boolean> {
  const firstOf = (ring: string) => [...byId].find(([, listing]) => listing.seedRing === ring)?.[0];
  const rows = [];
  let passed = true;
  for (const ring of ['A', 'B', 'C']) {
    const reportId = firstOf(ring);
    if (!reportId) continue;
    const { members, sharedIdentifiers } = await getRing(reportId);
    const unknown = members.filter((member) => !byId.has(member._id)).length;
    if (unknown > 0) {
      console.warn(`getRing returned ${unknown} reports that were not imported: lib/ring.ts is still the stub, ring check skipped`);
      return false;
    }
    const groups = new Set<string>(members.map((member) => byId.get(member._id)!.seedRing ?? LEGIT));
    const expected = ring === 'B' ? ['B'] : ['A', 'C'];
    const ok = groups.size === expected.length && expected.every((group) => groups.has(group));
    passed &&= ok;
    if (!ok) process.exitCode = 1;
    rows.push({
      from: byId.get(reportId)!.key,
      members: members.length,
      rings: [...groups].sort().join('+'),
      maxHops: Math.max(0, ...members.map((member) => member.hops)),
      sharedIdentifiers: sharedIdentifiers.length,
      expected: expected.join('+'),
      result: ok ? 'PASS' : 'FAIL',
    });
  }
  console.table(rows);
  return passed;
}

async function printCalibration(byId: Map<string, SeedListing>): Promise<void> {
  const counts = new Map<string, Record<Verdict['level'], number>>();
  for (const [reportId, listing] of byId) {
    const group = listing.seedRing ?? LEGIT;
    const { level } = await computeVerdict(reportId);
    const row = counts.get(group) ?? { LOW: 0, MEDIUM: 0, HIGH: 0 };
    row[level] += 1;
    counts.set(group, row);
  }
  console.table([...counts].sort(([left], [right]) => left.localeCompare(right)).map(([group, row]) => ({ group, ...row })));
  const legit = counts.get(LEGIT);
  if (legit) {
    const total = LEVELS.reduce((sum, level) => sum + legit[level], 0);
    console.log(`Legit LOW: ${Math.round((100 * legit.LOW) / total)}% (target at least 95%)`);
  }
  try {
    const photos = (await import(PHOTOS_MODULE)) as { PHOTO_THRESHOLD?: number };
    console.log(`PHOTO_THRESHOLD = ${photos.PHOTO_THRESHOLD ?? 'not exported'}`);
  } catch {
    console.log('PHOTO_THRESHOLD: lib/photos.ts not available yet');
  }
}

async function main(): Promise<void> {
  refuseSharedWithoutFlag();
  const listings = JSON.parse(await readFile(LISTINGS_FILE, 'utf8')) as SeedListing[];
  const database = await getDb();
  for (const name of RESET_COLLECTIONS) await database.collection(name).deleteMany({});
  console.log(`Reset ${RESET_COLLECTIONS.join(', ')} in ${database.databaseName}`);
  const byId = await importListings(listings);
  const ringsOk = await printRingCheck(byId);
  await printCalibration(byId);
  console.log(`Imported ${byId.size} listings into ${database.databaseName}${ringsOk ? '' : ' (ring check not passed)'}`);
  await (await getClient()).close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
