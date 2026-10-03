// Owner: B
// Upserts the known scam scripts from seed/patterns.json into scam_patterns, keyed by code.
// Sources for every pattern: seed/patterns-sources.md. Keywords stay in the JSON file for
// scriptMatch's keyword fallback; the documents match ScamPattern in CONTRACT.md.
// Usage: npx tsx scripts/seed-patterns.ts [--shared]
import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFile } from 'node:fs/promises';
import { getClient, getDb } from '../lib/db';
import type { ScamPattern } from '../lib/types';

const SHARED_DB = 'scamring';
const PATTERNS_FILE = 'seed/patterns.json';

type SeedPattern = Omit<ScamPattern, '_id'> & { keywords: string[] };

function refuseSharedWithoutFlag(): void {
  const database = process.env.DB_NAME || SHARED_DB;
  if (database === SHARED_DB && !process.argv.includes('--shared')) {
    console.error(`Refusing to write scam_patterns in the shared database "${SHARED_DB}". Re-run with --shared.`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  refuseSharedWithoutFlag();
  const patterns = JSON.parse(await readFile(PATTERNS_FILE, 'utf8')) as SeedPattern[];
  const db = await getDb();
  const result = await db.collection<ScamPattern>('scam_patterns').bulkWrite(
    patterns.map(({ keywords, ...pattern }) => {
      void keywords;
      return { updateOne: { filter: { code: pattern.code }, update: { $set: pattern }, upsert: true } };
    }),
  );
  console.table(patterns.map(({ code, category, title }) => ({ code, category, title })));
  console.log(
    `${patterns.length} patterns into ${db.databaseName}.scam_patterns (${result.upsertedCount} inserted, ${result.modifiedCount} updated)`,
  );
  await (await getClient()).close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
