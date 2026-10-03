import { config } from 'dotenv';
config({ path: '.env.local' });

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, type Document } from 'mongodb';
import { getClient, getDb, getDbName } from '../lib/db';
import { getRing } from '../lib/ring';

if (getDbName() === 'scamring') {
  console.error('Refusing to run: DB_NAME is the shared "scamring". Use a sandbox, e.g. DB_NAME=scamring_a.');
  process.exit(1);
}

const testRun = `ring-test-${new ObjectId().toHexString()}`;
const tag = (name: string) => `phone:${testRun}-${name}`;
const ids = { X: new ObjectId(), Y: new ObjectId(), Z: new ObjectId(), W: new ObjectId(), R: new ObjectId() };

function doc(_id: ObjectId, identifiers: string[], status = 'pending'): Document {
  return {
    _id, source: 'other', text: 'test', area: 'Dublin 1', kind: 'room', bedrooms: null, priceEur: 500,
    photoIds: [], identifiers, identifierHints: [], status, seed: false, createdAt: new Date(), testRun,
  };
}

async function reports() {
  return (await getDb()).collection('reports');
}

before(async () => {
  const col = await reports();
  await col.createIndex({ identifiers: 1 }, { name: 'identifiers_1' });
  await col.insertMany([
    doc(ids.X, [tag('xy')]),
    doc(ids.Y, [tag('xy'), tag('yz')]),
    doc(ids.Z, [tag('yz')]),
    doc(ids.W, [tag('w')]),
    doc(ids.R, [tag('xy')], 'rejected'),
  ]);
});

after(async () => {
  await (await reports()).deleteMany({ testRun });
  await (await getClient()).close();
});

test('getRing(X) returns X, Y and Z (Z at 2 hops), not W and not rejected R', async () => {
  const { members, sharedIdentifiers } = await getRing(ids.X.toString());
  const hops = Object.fromEntries(members.map((m) => [m._id, m.hops]));
  assert.deepEqual(hops, { [ids.X.toString()]: 0, [ids.Y.toString()]: 1, [ids.Z.toString()]: 2 });
  assert.deepEqual([...sharedIdentifiers].sort(), [tag('xy'), tag('yz')].sort());
});

test('a report with nothing in common is a ring of one; a bad id is empty', async () => {
  const { members } = await getRing(ids.W.toString());
  assert.deepEqual(members.map((m) => m._id), [ids.W.toString()]);
  assert.deepEqual(await getRing('nope'), { members: [], sharedIdentifiers: [] });
});

function findIndexScan(plan: unknown): Document | null {
  if (!plan || typeof plan !== 'object') return null;
  const node = plan as Document;
  if (node.stage === 'IXSCAN') return node;
  for (const value of Object.values(node)) {
    const hit = findIndexScan(value);
    if (hit) return hit;
  }
  return null;
}

test('each $graphLookup hop ($in over identifiers) uses IXSCAN on identifiers_1', async () => {
  const col = await reports();
  const explain = await col.find({ identifiers: { $in: [tag('xy'), tag('yz')] } }).explain('executionStats');
  const ixscan = findIndexScan(explain.queryPlanner.winningPlan);
  const { totalKeysExamined, totalDocsExamined, nReturned } = explain.executionStats;
  console.log(`winning stage: IXSCAN ${ixscan?.indexName}`);
  console.log({ totalKeysExamined, totalDocsExamined, nReturned });
  assert.equal(ixscan?.indexName, 'identifiers_1');
});
