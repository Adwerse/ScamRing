import { config } from 'dotenv';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { getClient, getDb } from '@/lib/db';
import { computeVerdict } from '@/lib/verdict';
import type { Report } from '@/lib/types';
import * as textClone from '@/lib/signals/textClone';
import * as scriptMatch from '@/lib/signals/scriptMatch';
import * as priceLow from '@/lib/signals/priceLow';

config({ path: '.env', quiet: true });

function distribution(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.floor((sorted.length - 1) * p)] ?? null;
  return {
    n: sorted.length,
    min: sorted[0] ?? null,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1) ?? null,
  };
}

async function main() {
  console.log('Exported thresholds (only owners A/B change these):');
  for (const [name, module] of Object.entries({ textClone, scriptMatch, priceLow })) {
    console.log(
      name,
      Object.fromEntries(Object.entries(module).filter(([key]) => /THRESHOLD/.test(key))),
    );
  }
  const db = await getDb();
  const reports = await db.collection<Report>('reports').find({ seed: true }).toArray();
  if (!reports.length) {
    console.log('NOT READY: no seed reports. Ask B to seed the selected database.');
    process.exitCode = 1;
    return;
  }
  const table: Record<string, { LOW: number; MEDIUM: number; HIGH: number }> = {};
  const scores: Record<string, number[]> = {};
  const vectorPath = resolve('lib/vector.ts');
  const vector =
    existsSync(vectorPath) && (process.env.DB_NAME || 'scamring') === 'scamring'
      ? await import(vectorPath)
      : null;
  if (!vector)
    console.log(
      'Raw vector scores unavailable: Core helper missing or sandbox has no search indexes.',
    );
  for (const report of reports) {
    const verdict = await computeVerdict(report._id.toString());
    const group = report.seedRing || 'legit';
    table[group] ??= { LOW: 0, MEDIUM: 0, HIGH: 0 };
    table[group][verdict.level]++;
    if (vector) {
      for (const [name, collection, index] of [
        ['textClone', 'reports', 'reports_text_vec'],
        ['scriptMatch', 'scam_patterns', 'patterns_vec'],
      ]) {
        const pipeline = [
          vector.vectorSearchStage({
            index,
            path: 'text',
            text: report.text,
            limit: 10,
            ...(collection === 'reports'
              ? { filter: { status: { $in: ['pending', 'confirmed_scam'] } } }
              : {}),
          }),
          ...(collection === 'reports' ? [{ $match: { _id: { $ne: report._id } } }] : []),
          { $project: { _id: 0, score: { $meta: 'vectorSearchScore' } } },
        ];
        const hits = await db
          .collection(collection)
          .aggregate<{ score: number }>(pipeline)
          .toArray();
        const key = `${name}:${report.seedRing ? 'ring' : 'legit'}`;
        scores[key] ??= [];
        if (hits.length) scores[key].push(Math.max(...hits.map((h) => h.score)));
      }
    }
  }
  console.table(table);
  console.table(
    Object.fromEntries(
      Object.entries(scores).map(([key, values]) => [key, distribution(values)]),
    ),
  );
  for (const name of ['textClone', 'scriptMatch']) {
    const legit = distribution(scores[`${name}:legit`] ?? []);
    const ring = distribution(scores[`${name}:ring`] ?? []);
    if (legit.p95 != null && ring.min != null)
      console.log(
        `${name}: legitimate p95=${legit.p95}, ring min=${ring.min}; ${ring.min > legit.p95 ? `suggest threshold ${(ring.min + legit.p95) / 2}` : 'scores overlap; ask the signal owner to inspect evidence before tuning'}`,
      );
  }
  const legit = table.legit;
  const totalLegit = legit ? legit.LOW + legit.MEDIUM + legit.HIGH : 0;
  const ringGroups = Object.keys(table).filter((key) => key !== 'legit');
  const ringsPass =
    ringGroups.length > 0 && ringGroups.every((key) => table[key].LOW === 0);
  const bPending =
    reports.some((r) => r.seedRing === 'B') &&
    !reports.some((r) => r.seedRing === 'B' && r.status === 'confirmed_scam');
  const bPass = !bPending || (table.B.LOW === 0 && table.B.HIGH === 0);
  const legitPass = totalLegit > 0 && legit.LOW / totalLegit >= 0.95;
  console.log(`${ringsPass ? 'PASS' : 'FAIL'} all ring reports at least MEDIUM`);
  console.log(`${bPass ? 'PASS' : 'FAIL'} ring B MEDIUM while unconfirmed`);
  console.log(`${legitPass ? 'PASS' : 'FAIL'} at least 95% legitimate reports LOW`);
  if (!ringsPass || !bPass || !legitPass) process.exitCode = 1;
}

main()
  .catch(() => {
    console.error(
      'FAIL calibration unavailable; check Atlas credentials, seed data and vector helper/indexes.',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await (await getClient()).close();
    } catch {}
  });
