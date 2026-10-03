import { config } from 'dotenv';
config({ path: '.env.local' });

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, type Document } from 'mongodb';
import { getClient, getDb, getDbName } from '../lib/db';
import { fanOut, refreshVerdicts } from '../lib/fanout';

if (getDbName() === 'scamring') {
  console.error('Refusing to run: DB_NAME is the shared "scamring". Use a sandbox, e.g. DB_NAME=scamring_a.');
  process.exit(1);
}

const testRun = `fanout-test-${new ObjectId().toHexString()}`;
const shared = `phone:${testRun}`;
const confirmed = new ObjectId();
const checked = new ObjectId();
const sessionId = `${testRun}-session`;
const placeholder = { score: 1, level: 'LOW', signals: [], summary: 'placeholder', computedAt: new Date(0) };

function doc(_id: ObjectId, status: string): Document {
  return {
    _id, source: 'other', text: 'fan-out test listing', area: 'Dublin 1', kind: 'room', bedrooms: null, priceEur: 500,
    photoIds: [], identifiers: [shared], identifierHints: [], status, seed: false, createdAt: new Date(), testRun,
    verdict: placeholder,
  };
}

before(async () => {
  const db = await getDb();
  await db.collection('reports').insertMany([doc(confirmed, 'confirmed_scam'), doc(checked, 'pending')]);
  await db.collection('checks').insertOne({ _id: new ObjectId(), sessionId, reportId: checked, createdAt: new Date(), testRun });
});

after(async () => {
  const db = await getDb();
  await db.collection('reports').deleteMany({ testRun });
  await db.collection('checks').deleteMany({ testRun });
  await db.collection('alerts').deleteMany({ sessionId });
  await (await getClient()).close();
});

test('fanOut alerts the session without waiting to recompute verdicts', async () => {
  const created = await fanOut(confirmed.toString(), [checked.toString()]);
  assert.equal(created, 1);
  const alert = await (await getDb()).collection('alerts').findOne({ sessionId, triggerReportId: confirmed });
  assert.equal(alert?.reportId.toString(), checked.toString());
  const report = await (await getDb()).collection('reports').findOne({ _id: checked });
  assert.equal(report?.verdict.summary, 'placeholder');
});

test('refreshVerdicts then recomputes the ring with the confirmation', async () => {
  await refreshVerdicts(confirmed.toString(), [checked.toString()]);
  const report = await (await getDb()).collection('reports').findOne({ _id: checked });
  assert.notEqual(report?.verdict.summary, 'placeholder');
  assert.ok(report?.verdict.signals.some((signal: { code: string }) => signal.code === 'ring_link'));
});
