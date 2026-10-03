import { config } from 'dotenv';
config({ path: '.env.local' });
delete process.env.ANTHROPIC_API_KEY; // template summaries: no network, deterministic

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import sharp from 'sharp';
import { getClient, getDb, getDbName } from '../lib/db';
import { ingestReport, type IngestInput } from '../lib/ingest';
import { computeVerdict } from '../lib/verdict';
import { POST as check } from '../app/api/check/route';
import { GET as getReport } from '../app/api/reports/[id]/route';

if (getDbName() === 'scamring') {
  console.error('Refusing to run: DB_NAME is the shared "scamring". Use a sandbox, e.g. DB_NAME=scamring_a.');
  process.exit(1);
}

const testRun = `verdict-test-${new ObjectId().toHexString()}`;
const tracked: ObjectId[] = [];
const fixture = (name: string) => JSON.parse(readFileSync(`fixtures/${name}.json`, 'utf8'));

/** A picture that looks unlike any other seed's picture. */
function picture(seed: number): Promise<Buffer> {
  let n = seed * 9301 + 49297;
  const rnd = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
  const rects = Array.from({ length: 7 }, () => {
    const c = Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0');
    return `<rect x="${rnd() * 900}" y="${rnd() * 600}" width="${100 + rnd() * 400}" height="${100 + rnd() * 300}" fill="#${c}"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#eee"/>${rects.join('')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function track(id: ObjectId): Promise<void> {
  tracked.push(id);
  await (await getDb()).collection('reports').updateOne({ _id: id }, { $set: { testRun } });
}

async function ingest(overrides: Partial<IngestInput>) {
  const report = await ingestReport({
    source: 'facebook', text: 'Room to rent', area: 'Dublin 8', kind: 'room', bedrooms: null, priceEur: 1000, photos: [], ...overrides,
  });
  await track(report._id);
  return report;
}

const codes = (v: { signals: { code: string }[] }) => v.signals.map((s) => s.code);

before(async () => {
  await (await getDb()).collection('reports').createIndex({ identifiers: 1 }, { name: 'identifiers_1' });
});

after(async () => {
  const db = await getDb();
  await db.collection('reports').deleteMany({ testRun });
  for (const name of ['photos', 'photos_blob', 'checks']) await db.collection(name).deleteMany({ reportId: { $in: tracked } });
  await (await getClient()).close();
});

test('a new report reusing a confirmed scam\'s photo is HIGH with photo_reuse and ring_link', async () => {
  const photo = await picture(1);
  await ingest({ status: 'confirmed_scam', area: 'Dublin 8', priceEur: 1200, photos: [photo] });
  const fresh = await ingest({ area: 'Dublin 2', priceEur: 600, photos: [photo] });
  const verdict = await computeVerdict(fresh._id.toString());
  assert.ok(codes(verdict).includes('ring_link') && codes(verdict).includes('photo_reuse'), codes(verdict).join());
  assert.equal(verdict.signals.find((s) => s.code === 'ring_link')?.points, 45);
  assert.equal(verdict.signals.find((s) => s.code === 'photo_reuse')?.points, 35);
  assert.ok(verdict.score >= 80 && verdict.score <= 100);
  assert.equal(verdict.level, 'HIGH');
  assert.match(verdict.signals.find((s) => s.code === 'ring_link')!.evidence, /photo.*confirmed as a scam \(1 hop, 2 linked reports\)/);
  assert.match(verdict.signals.find((s) => s.code === 'photo_reuse')!.evidence, /^Same photo used in 1 other listing \(areas Dublin 8; prices €1200\)\.$/);
  const stored = await (await getDb()).collection('reports').findOne({ _id: fresh._id });
  assert.equal(stored?.verdict.score, verdict.score);
});

test('same area and a price within 15% is not photo reuse, but still a ring link', async () => {
  const photo = await picture(2);
  await ingest({ status: 'confirmed_scam', area: 'Dublin 6', priceEur: 1000, photos: [photo] });
  const fresh = await ingest({ area: 'dublin 6', priceEur: 1100, photos: [photo] });
  const verdict = await computeVerdict(fresh._id.toString());
  assert.ok(!codes(verdict).includes('photo_reuse'));
  assert.ok(codes(verdict).includes('ring_link'));
});

test('three reports sharing a phone number: "Part of a cluster of 3 reports", 10 points', async () => {
  const phone = `087 ${100 + (Date.now() % 800)} ${1000 + (Date.now() % 8000)}`;
  await ingest({ text: `Room A, call ${phone}` });
  await ingest({ text: `Room B, call ${phone}` });
  const third = await ingest({ text: `Room C, call ${phone}` });
  const verdict = await computeVerdict(third._id.toString());
  const signal = verdict.signals.find((s) => s.code === 'ring_link');
  assert.equal(signal?.points, 10);
  assert.equal(signal?.title, 'Part of a cluster of 3 reports');
  assert.equal(signal?.refs.length, 2);
});

test('an unrelated report has neither signal and is LOW', async () => {
  const lone = await ingest({ photos: [await picture(3)], text: 'Double room, bills included' });
  const verdict = await computeVerdict(lone._id.toString());
  assert.ok(!codes(verdict).includes('ring_link') && !codes(verdict).includes('photo_reuse'));
  assert.equal(verdict.level, 'LOW');
  assert.ok(verdict.summary.length > 0);
});

function jsonRequest(body: unknown, cookie = 'sr_sid=session-under-test') {
  return new NextRequest('http://localhost/api/check', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
  });
}

test('POST /api/check (JSON): exact fixture shape, price parsed from the text, check recorded', async () => {
  const res = await check(jsonRequest({ text: 'Lovely double room in Rathmines, €650/month, bills incl.', area: 'Dublin 6' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  const expected = fixture('check-response');
  assert.deepEqual(Object.keys(body), Object.keys(expected));
  assert.deepEqual(Object.keys(body.verdict), Object.keys(expected.verdict));
  assert.deepEqual(Object.keys(body.ring), Object.keys(expected.ring));
  assert.deepEqual(body.ring, { size: 1, confirmedCount: 0 });
  assert.equal(typeof body.verdict.computedAt, 'string');
  await track(new ObjectId(body.reportId));
  const db = await getDb();
  assert.equal((await db.collection('reports').findOne({ _id: new ObjectId(body.reportId) }))?.priceEur, 650);
  const recorded = await db.collection('checks').findOne({ reportId: new ObjectId(body.reportId) });
  assert.equal(recorded?.sessionId, 'session-under-test');
});

test('POST /api/check (multipart with a photo): reuses a confirmed scam photo and is HIGH', async () => {
  const photo = await picture(4);
  await ingest({ status: 'confirmed_scam', area: 'Dublin 8', priceEur: 1200, photos: [photo] });
  const form = new FormData();
  form.set('text', 'Gorgeous flat, only 600 euro, landlord abroad');
  form.set('area', 'Dublin 2');
  form.set('photos', new Blob([new Uint8Array(photo)], { type: 'image/png' }), 'flat.png');
  const res = await check(new NextRequest('http://localhost/api/check', { method: 'POST', headers: { cookie: 'sr_sid=s2' }, body: form }));
  assert.equal(res.status, 200);
  const body = await res.json();
  await track(new ObjectId(body.reportId));
  assert.equal(body.verdict.level, 'HIGH');
  assert.deepEqual(body.ring, { size: 2, confirmedCount: 1 });
});

test('POST /api/check rejects bad requests', async () => {
  assert.equal((await check(jsonRequest({ area: 'Dublin 1' }))).status, 400);
  assert.equal((await check(new NextRequest('http://localhost/api/check', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' }))).status, 415);
  const form = new FormData();
  form.set('text', 'x');
  for (let i = 0; i < 7; i++) form.append('photos', new Blob([new Uint8Array(await picture(10 + i))], { type: 'image/png' }), `p${i}.png`);
  assert.equal((await check(new NextRequest('http://localhost/api/check', { method: 'POST', body: form }))).status, 400);
  const bad = new FormData();
  bad.set('text', 'x');
  bad.set('photos', new Blob(['not an image'], { type: 'image/png' }), 'x.png');
  assert.equal((await check(new NextRequest('http://localhost/api/check', { method: 'POST', body: bad }))).status, 400);
});

test('GET /api/reports/[id]: fixture shape without identifiers; 404 when unknown', async () => {
  const report = await ingest({ text: 'Room, call 087 555 1234', photos: [await picture(5)] });
  await computeVerdict(report._id.toString());
  const ask = (id: string) => getReport(new Request('http://localhost'), { params: Promise.resolve({ id }) });
  const body = await (await ask(report._id.toString())).json();
  assert.deepEqual(Object.keys(body), Object.keys(fixture('report')));
  assert.ok(!('identifiers' in body));
  assert.ok(!JSON.stringify(body).includes('555 1234') && body.text.includes('[phone]'));
  assert.equal((await ask(new ObjectId().toString())).status, 404);
  assert.equal((await ask('nope')).status, 404);
});

/** A fake Anthropic Messages API: records request bodies, answers after `delayMs`. */
async function fakeAnthropic(reply: string, delayMs = 0): Promise<{ server: Server; bodies: string[]; url: string }> {
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      bodies.push(data);
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'msg_test', type: 'message', role: 'assistant', model: 'test', stop_reason: 'end_turn', stop_sequence: null,
          content: [{ type: 'text', text: reply }], usage: { input_tokens: 1, output_tokens: 1 },
        }));
      }, delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, bodies, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

async function verdictWithModel(reply: string, delayMs: number) {
  const photo = await picture(30 + delayMs + reply.length);
  await ingest({ status: 'confirmed_scam', area: 'Dublin 8', priceEur: 1200, photos: [photo] });
  const secretText = 'SECRET LISTING TEXT call 087 999 0000';
  const fresh = await ingest({ area: 'Dublin 2', priceEur: 600, photos: [photo], text: secretText });
  const fake = await fakeAnthropic(reply, delayMs);
  Object.assign(process.env, { ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: fake.url, ANTHROPIC_MODEL: 'test-model' });
  const started = Date.now();
  try {
    const verdict = await computeVerdict(fresh._id.toString());
    return { verdict, bodies: fake.bodies, ms: Date.now() - started };
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_MODEL;
    fake.server.close();
  }
}

test('summary: uses the model text, sends only signal titles and evidence', async () => {
  const { verdict, bodies } = await verdictWithModel('This listing shares a photo with a reported one. Please be careful.', 0);
  assert.equal(verdict.summary, 'This listing shares a photo with a reported one. Please be careful.');
  assert.equal(bodies.length, 1);
  const sent = JSON.parse(bodies[0]);
  assert.equal(sent.model, 'test-model');
  assert.match(JSON.stringify(sent), /Same photo in other listings/);
  assert.ok(!bodies[0].includes('SECRET LISTING TEXT') && !bodies[0].includes('999 0000'), 'listing text must not be sent');
});

test('summary: more than 60 words is cut to at most 60', async () => {
  const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ') + '. ' + Array.from({ length: 60 }, (_, i) => `more${i}`).join(' ') + '.';
  const { verdict } = await verdictWithModel(long, 0);
  assert.ok(verdict.summary.split(/\s+/).length <= 60);
  assert.ok(verdict.summary.endsWith('.'));
});

test('summary: a model slower than 3 seconds falls back to the signal titles', async () => {
  const { verdict, ms } = await verdictWithModel('too late', 6000);
  assert.match(verdict.summary, /^High risk: .*Same photo in other listings/);
  assert.ok(ms < 5500, `took ${ms} ms`);
});
