import { config } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Verdict } from '@/lib/types';

config({ path: '.env', quiet: true });

const base = process.env.BASE_URL || 'http://localhost:3000';

const sid = crypto.randomUUID();

const cookie = `sr_sid=${sid}`;

let failures = 0;

async function step(name: string, run: () => Promise<void>) {
  const start = performance.now();
  try {
    await run();
    console.log(`PASS ${name} (${Math.round(performance.now() - start)}ms)`);
  } catch (error) {
    failures++;
    console.log(
      `FAIL ${name} (${Math.round(performance.now() - start)}ms): ${error instanceof Error ? error.message : 'unexpected failure'}`,
    );
  }
}

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15000),
    headers: { Cookie: cookie, ...init.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${data.error || 'request failed'}`);
  return data;
}

type CheckResult = { reportId: string; verdict: Verdict };

type Listing = {
  text: string;
  source: string;
  area: string;
  kind: string;
  bedrooms: number | null;
  priceEur: number | null;
  seedRing?: string;
  photos: string[];
};

async function check(
  input: Pick<Listing, 'text' | 'source' | 'area' | 'kind' | 'bedrooms' | 'priceEur'>,
  expected: string,
  photoFile?: string,
): Promise<CheckResult> {
  const form = new FormData();
  for (const [key, value] of Object.entries(input))
    if (value != null) form.set(key, String(value));
  if (photoFile)
    form.append(
      'photos',
      new Blob([new Uint8Array(await readFile(resolve(photoFile)))], {
        type: 'image/jpeg',
      }),
      'demo.jpg',
    );
  const result: CheckResult = await api('/api/check', { method: 'POST', body: form });
  if (result.verdict.level !== expected)
    throw new Error(`expected ${expected}, received ${result.verdict.level}`);
  return result;
}

async function main() {
  if (
    (process.env.DB_NAME || 'scamring') !== 'scamring' ||
    !process.argv.includes('--shared')
  ) {
    throw new Error(
      'Smoke changes shared demo data. Set DB_NAME=scamring and pass --shared after coordinating with B. BASE_URL must point to a server using that same database.',
    );
  }
  console.log(
    `Smoke against ${base}; confirms a ring B report. Ask B to reseed afterwards.`,
  );
  const listings: Listing[] = JSON.parse(
    await readFile(resolve('seed/listings.json'), 'utf8'),
  );
  let ringB: CheckResult | undefined;
  await step('ring B post is MEDIUM', async () => {
    const listing = listings.find((item) => item.seedRing === 'B');
    if (!listing) throw new Error('Ring B seed listing missing');
    const { text, source, area, kind, bedrooms, priceEur } = listing;
    ringB = await check({ text, source, area, kind, bedrooms, priceEur }, 'MEDIUM');
  });
  await step('ring A photo is HIGH', async () => {
    const photo = listings.find((item) => item.seedRing === 'A' && item.photos.length)
      ?.photos[0];
    if (!photo) throw new Error('Ring A seed photo missing');
    await check(
      {
        text: 'Room available in Glasnevin, €450 monthly. Viewing by appointment.',
        source: 'other',
        area: 'Glasnevin',
        kind: 'room',
        bedrooms: null,
        priceEur: 450,
      },
      'HIGH',
      resolve('seed/photos', photo),
    );
  });
  await step('ordinary listing is LOW', async () => {
    await check(
      {
        text: 'Bright room in a shared home in Glasnevin for €950 per month. Viewing in person this weekend. Meet the housemates and review the lease before deciding. Bills separate; no payment before viewing.',
        source: 'other',
        area: 'Glasnevin',
        kind: 'room',
        bedrooms: null,
        priceEur: 950,
      },
      'LOW',
    );
  });
  await step(
    'confirmation delivers alert within 3s and verdict becomes HIGH',
    async () => {
      if (!ringB) throw new Error('Ring B check failed; live test cannot proceed');
      const graph = await api(`/api/reports/${ringB.reportId}/ring`);
      const target = graph.nodes.find(
        (n: { type: string; id: string; status?: string }) =>
          n.type === 'report' && n.id !== ringB!.reportId && n.status === 'pending',
      );
      if (!target) throw new Error('No pending linked ring B report');
      const since = new Date().toISOString();
      const start = performance.now();
      await api(`/api/moderation/${target.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-moderator-pin': process.env.MODERATOR_PIN || '1234',
        },
        body: JSON.stringify({ action: 'confirm', by: 'smoke' }),
      });
      let delivered = false;
      while (performance.now() - start < 3000) {
        const alerts: { reportId: string; triggerReportId: string }[] = await api(
          `/api/alerts?since=${encodeURIComponent(since)}`,
        );
        if (
          alerts.some(
            (a) => a.reportId === ringB!.reportId && a.triggerReportId === target.id,
          )
        ) {
          delivered = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!delivered || performance.now() - start > 3000)
        throw new Error('No matching alert within 3 seconds');
      const report = await api(`/api/reports/${ringB.reportId}`);
      if (report.verdict?.level !== 'HIGH')
        throw new Error('Checked report did not become HIGH');
    },
  );
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
