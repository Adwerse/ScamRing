// Owner: D (built by B)
// Prints how the stored seed verdicts fall per ring against the demo targets, which signal fires
// where, and the thresholds each signal file exports. Reads stored verdicts only: no embedding
// calls. Owners adjust the constants at the top of their own signal files.
// Usage: npx tsx scripts/calibrate.ts (after import-seed computed verdicts)
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getClient, getDb } from '../lib/db';
import { PHOTO_THRESHOLD } from '../lib/photos';
import { PRICE_LOW_THRESHOLD } from '../lib/signals/priceLow';
import { SCRIPT_KEYWORD_MIN_HITS, SCRIPT_THRESHOLD } from '../lib/signals/scriptMatch';
import { TEXT_CLONE_THRESHOLD } from '../lib/signals/textClone';
import type { Report, SignalCode, Verdict } from '../lib/types';

const RINGS: Record<string, string> = { A: 'Courier', B: 'Revolut', C: 'WhatsApp' };
const LEGIT = 'legit';
const LEGIT_LOW_TARGET = 0.95;
const CODES: SignalCode[] = ['ring_link', 'photo_reuse', 'text_clone', 'script_match', 'price_low'];

type Seeded = Pick<Report, 'seedRing' | 'verdict'>;

function target(group: string, levels: Record<Verdict['level'], number>, total: number): boolean {
  if (group === LEGIT) return levels.LOW / total >= LEGIT_LOW_TARGET;
  if (group === 'B') return levels.MEDIUM === total;
  return levels.LOW === 0;
}

async function main(): Promise<void> {
  const database = await getDb();
  const reports = await database
    .collection<Report>('reports')
    .find({ seed: true }, { projection: { seedRing: 1, verdict: 1 } })
    .toArray() as Seeded[];
  const missing = reports.filter((report) => !report.verdict).length;
  if (missing > 0) console.warn(`${missing} seed reports have no stored verdict; run import-seed without --no-verdicts`);

  const groups = Map.groupBy(reports.filter((report) => report.verdict), (report) => report.seedRing ?? LEGIT);
  let passed = true;
  const rows = [...groups].sort(([left], [right]) => left.localeCompare(right)).map(([group, members]) => {
    const levels = { LOW: 0, MEDIUM: 0, HIGH: 0 };
    for (const member of members) levels[member.verdict!.level] += 1;
    const ok = target(group, levels, members.length);
    passed &&= ok;
    const fires = Object.fromEntries(CODES.map((code) => [code, members.filter((member) => member.verdict!.signals.some((signal) => signal.code === code)).length]));
    return { group: RINGS[group] ?? group, n: members.length, ...levels, ...fires, target: ok ? 'met' : 'MISSED' };
  });
  console.log(`Seed verdicts in ${database.databaseName}`);
  console.table(rows);
  console.log('Targets: every ring listing MEDIUM or HIGH, Revolut ring MEDIUM (not HIGH) until confirmed, 95%+ of legit LOW');
  console.table([
    { constant: 'PRICE_LOW_THRESHOLD', value: PRICE_LOW_THRESHOLD, file: 'lib/signals/priceLow.ts' },
    { constant: 'SCRIPT_THRESHOLD', value: SCRIPT_THRESHOLD, file: 'lib/signals/scriptMatch.ts' },
    { constant: 'SCRIPT_KEYWORD_MIN_HITS', value: SCRIPT_KEYWORD_MIN_HITS, file: 'lib/signals/scriptMatch.ts' },
    { constant: 'TEXT_CLONE_THRESHOLD', value: TEXT_CLONE_THRESHOLD, file: 'lib/signals/textClone.ts' },
    { constant: 'PHOTO_THRESHOLD', value: PHOTO_THRESHOLD, file: 'lib/photos.ts' },
  ]);
  await (await getClient()).close();
  process.exit(passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
