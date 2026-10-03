// Owner: D (built by B)
// End-to-end smoke test against the running app (BASE_URL, default http://localhost:3000), as one
// browser session: the three demo checks, then a moderator confirms a Revolut ring listing and the
// session must get an alert within 3 seconds and see its verdict rise.
// It changes data (adds checks, confirms a report): reseed the shared database afterwards.
// Usage: MODERATOR_PIN=… npx tsx scripts/smoke.ts --shared
import { config } from 'dotenv';
config({ path: ['.env.local', '.env'], quiet: true });

import { readFile } from 'node:fs/promises';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ALERT_DEADLINE_MS = 3000;
const VERDICT_DEADLINE_MS = 15000;
const POLL_MS = 250;
const REUSED_PHOTO = 'public/demo/reuse.jpg';

type Level = 'LOW' | 'MEDIUM' | 'HIGH';
type CheckResponse = { reportId: string; verdict: { score: number; level: Level } };
type RingNode = { id: string; type: 'report' | 'identifier'; status?: string; isCurrent?: boolean };

let cookie = '';
let failures = 0;

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${BASE_URL}${path}`, { ...init, signal: AbortSignal.timeout(15000), headers: { ...init.headers, ...(cookie ? { cookie } : {}) } });
  const session = response.headers.get('set-cookie')?.match(/sr_sid=[^;]+/)?.[0];
  if (session) cookie = session;
  return response;
}

async function step<T>(name: string, run: () => Promise<{ ok: boolean; detail: string; value?: T }>): Promise<T | undefined> {
  const started = Date.now();
  try {
    const { ok, detail, value } = await run();
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${Date.now() - started} ms  ${detail}`);
    return value;
  } catch (error) {
    failures++;
    console.log(`FAIL  ${name}  ${Date.now() - started} ms  ${(error as Error).message}`);
    return undefined;
  }
}

async function check(body: Record<string, string>, photo?: Buffer): Promise<CheckResponse> {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) form.append(key, value);
  if (photo) form.append('photos', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'reuse.jpg');
  const response = await call('/api/check', { method: 'POST', body: form });
  if (!response.ok) throw new Error(`/api/check returned ${response.status}`);
  return (await response.json()) as CheckResponse;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  if ((process.env.DB_NAME || 'scamring') === 'scamring' && !process.argv.includes('--shared'))
    throw new Error('Smoke changes shared demo data. Coordinate reseeding, then pass --shared. BASE_URL must use the same database.');
  const pin = process.env.MODERATOR_PIN;
  if (!pin) {
    console.error('Set MODERATOR_PIN to the PIN the app is running with.');
    process.exit(1);
  }
  console.log(`Smoke test against ${BASE_URL}`);

  const handle = await step('Revolut handle post is MEDIUM', async () => {
    const result = await check({ text: 'Room available in Glasnevin for €450 per month. Group viewing Saturday at 2pm. Contact @dublinroomsnow on Revolut to reserve your spot.', area: 'Glasnevin', kind: 'room', priceEur: '450', source: 'facebook' });
    return { ok: result.verdict.level === 'MEDIUM', detail: `${result.verdict.level} ${result.verdict.score}`, value: result };
  });

  await step('Reused Courier photo is HIGH', async () => {
    const result = await check({ text: 'Bright one-bedroom apartment in Rathmines for €1000 per month. Newly available, bills included.', area: 'Rathmines', kind: 'whole', bedrooms: '1', priceEur: '1000', source: 'whatsapp' }, await readFile(REUSED_PHOTO));
    return { ok: result.verdict.level === 'HIGH', detail: `${result.verdict.level} ${result.verdict.score}` };
  });

  await step('Ordinary listing is LOW', async () => {
    const result = await check({ text: 'Double room in Phibsborough, €950 per month plus bills. Sharing with two postgraduate students. Viewing by appointment this week.', area: 'Phibsborough', kind: 'room', priceEur: '950', source: 'daft' });
    return { ok: result.verdict.level === 'LOW', detail: `${result.verdict.level} ${result.verdict.score}` };
  });

  if (!handle) {
    console.log('FAIL  live confirmation  skipped: the Revolut handle check failed');
    process.exit(1);
  }

  const target = await step('Find a pending Revolut ring listing', async () => {
    const ring = (await (await call(`/api/reports/${handle.reportId}/ring`)).json()) as { nodes: RingNode[] };
    const pending = ring.nodes.find((node) => node.type === 'report' && node.id !== handle.reportId && node.status === 'pending');
    return { ok: Boolean(pending), detail: pending ? pending.id : 'none in the ring', value: pending?.id };
  });
  if (!target) process.exit(1);

  const confirmedAt = Date.now();
  await step('Moderator confirms it', async () => {
    const response = await call(`/api/moderation/${target}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm', pin }) });
    return { ok: response.ok, detail: `HTTP ${response.status}` };
  });

  await step(`Alert reaches this session within ${ALERT_DEADLINE_MS / 1000} s`, async () => {
    while (Date.now() - confirmedAt < ALERT_DEADLINE_MS) {
      const { alerts } = (await (await call('/api/alerts')).json()) as { alerts: { triggerReportId: string; reportId: string }[] };
      if (alerts.some((alert) => alert.triggerReportId === target && alert.reportId === handle.reportId)) return { ok: true, detail: `after ${Date.now() - confirmedAt} ms` };
      await sleep(POLL_MS);
    }
    return { ok: false, detail: 'no alert (is the worker running, or FANOUT_INLINE=1 set?)' };
  });

  await step('Checked listing becomes HIGH', async () => {
    while (Date.now() - confirmedAt < VERDICT_DEADLINE_MS) {
      const report = (await (await call(`/api/reports/${handle.reportId}`)).json()) as { verdict?: { score: number; level: Level } };
      if (report.verdict && report.verdict.level === 'HIGH') return { ok: true, detail: `${handle.verdict.level} ${handle.verdict.score} → ${report.verdict.level} ${report.verdict.score}` };
      await sleep(POLL_MS * 4);
    }
    return { ok: false, detail: `still ${handle.verdict.score}` };
  });

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
