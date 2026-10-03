// Owner: B
// Resets the report data and imports seed/listings.json through A's ingestReport, then prints
// the ring check (getRing compared with the exact expected members) and the verdict calibration table.
// Usage: npx tsx scripts/import-seed.ts [--shared] [--no-verdicts]
// --no-verdicts skips computeVerdict, which on the shared database makes an embedding call per
// listing (scriptMatch's vector search) and can run into the embedding rate limit.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFile } from 'node:fs/promises';
import { getClient, getDb } from '../lib/db';
import { ingestReport } from '../lib/ingest';
import { getRing } from '../lib/ring';
import { computeVerdict } from '../lib/verdict';
import type { Verdict } from '../lib/types';
import { MAX_HOPS, reachable, verify, type SeedListing } from './gen-seed';

const SHARED_DB = 'scamring';
const SHARED_FLAG = '--shared';
const NO_VERDICTS_FLAG = '--no-verdicts';
/** Pause between verdicts on the shared database, to stay under the embedding rate limit. */
const SHARED_VERDICT_PAUSE_MS = 2000;
const LISTINGS_FILE = 'seed/listings.json';
const PHOTOS_DIRECTORY = 'seed/photos';
const PHOTOS_MODULE = '../lib/photos';
const BATCH_SIZE = 5;
const RESET_COLLECTIONS = ['reports', 'photos', 'photos_blob', 'checks', 'alerts', 'moderation_events'];
const LEVELS: Verdict['level'][] = ['LOW', 'MEDIUM', 'HIGH'];
const LEGIT = 'legit';
const LEGIT_SAMPLES = 3;

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

/**
 * Calls getRing from the first member of each ring and from a few legit listings, and compares
 * the members it returns with the exact set seed/listings.json links within MAX_HOPS.
 */
async function printRingCheck(byId: Map<string, SeedListing>, listings: SeedListing[]): Promise<boolean> {
  const idOf = new Map([...byId].map(([reportId, listing]) => [listing.key, reportId]));
  const starts = [
    ...['A', 'B', 'C'].map((ring) => listings.find((listing) => listing.seedRing === ring)?.key),
    ...listings.filter((listing) => !listing.seedRing).slice(0, LEGIT_SAMPLES).map((listing) => listing.key),
  ].filter((key): key is string => key !== undefined);
  const rows = [];
  let passed = true;
  for (const key of starts) {
    const { members, sharedIdentifiers } = await getRing(idOf.get(key)!);
    const unknown = members.filter((member) => !byId.has(member._id)).length;
    if (unknown > 0) {
      console.warn(`getRing returned ${unknown} reports that were not imported: lib/ring.ts is still the stub, ring check skipped`);
      return false;
    }
    const actual = new Set(members.map((member) => byId.get(member._id)!.key).filter((memberKey) => memberKey !== key));
    const expected = new Set([...reachable(listings, key, MAX_HOPS).keys()].filter((memberKey) => memberKey !== key));
    const missing = [...expected].filter((memberKey) => !actual.has(memberKey));
    const extra = [...actual].filter((memberKey) => !expected.has(memberKey));
    const ok = missing.length === 0 && extra.length === 0;
    passed &&= ok;
    if (!ok) process.exitCode = 1;
    rows.push({
      from: key,
      expected: expected.size,
      returned: actual.size,
      missing: missing.join(' ') || '-',
      extra: extra.join(' ') || '-',
      maxHops: Math.max(0, ...members.map((member) => member.hops)),
      sharedIdentifiers: sharedIdentifiers.length,
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
    if ((process.env.DB_NAME || SHARED_DB) === SHARED_DB) await new Promise((resolve) => setTimeout(resolve, SHARED_VERDICT_PAUSE_MS));
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
  verify(listings);
  const database = await getDb();
  for (const name of RESET_COLLECTIONS) await database.collection(name).deleteMany({});
  console.log(`Reset ${RESET_COLLECTIONS.join(', ')} in ${database.databaseName}`);
  const byId = await importListings(listings);
  const ringsOk = await printRingCheck(byId, listings);
  if (process.argv.includes(NO_VERDICTS_FLAG)) console.log(`Skipped verdicts (${NO_VERDICTS_FLAG})`);
  else await printCalibration(byId);
  console.log(`Imported ${byId.size} listings into ${database.databaseName}${ringsOk ? '' : ' (ring check not passed)'}`);
  await (await getClient()).close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
