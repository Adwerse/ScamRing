import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, type MongoClient } from 'mongodb';
import { POST } from '../app/api/moderation/[id]/route';

const globals = globalThis as unknown as { _mongoClient?: Promise<MongoClient> };
const originalClient = globals._mongoClient;
const originalPin = process.env.MODERATOR_PIN;
const originalInline = process.env.FANOUT_INLINE;
const id = new ObjectId().toString();
let matched = true;
let auditFails = false;
let update: Record<string, unknown> | undefined;
let audit: Record<string, unknown> | undefined;
let sessionEnded = false;
let committed = false;
const session = {
  async withTransaction(run: () => Promise<void>) { await run(); committed = true; },
  async endSession() { sessionEnded = true; },
};
const db = {
  collection(name: string) {
    if (name === 'reports') return {
      async updateOne(_filter: unknown, change: Record<string, unknown>, options: { session: unknown }) {
        assert.equal(options.session, session);
        update = change;
        return { matchedCount: matched ? 1 : 0 };
      },
    };
    assert.equal(name, 'moderation_events');
    return {
      async insertOne(event: Record<string, unknown>, options: { session: unknown }) {
        assert.equal(options.session, session);
        if (auditFails) throw new Error('audit failed');
        audit = event;
      },
    };
  },
};
beforeEach(() => {
  process.env.MODERATOR_PIN = 'test-pin';
  process.env.FANOUT_INLINE = '0';
  globals._mongoClient = Promise.resolve({ db: () => db, startSession: () => session } as unknown as MongoClient);
  matched = true; auditFails = false; update = undefined; audit = undefined; committed = false; sessionEnded = false;
});
after(() => {
  globals._mongoClient = originalClient;
  if (originalPin === undefined) delete process.env.MODERATOR_PIN; else process.env.MODERATOR_PIN = originalPin;
  if (originalInline === undefined) delete process.env.FANOUT_INLINE; else process.env.FANOUT_INLINE = originalInline;
});
const decide = (body: unknown) => POST(new Request('http://localhost/api/moderation/' + id, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), { params: Promise.resolve({ id }) });

test('moderation is disabled without a configured PIN', async () => {
  delete process.env.MODERATOR_PIN;
  assert.equal((await decide({ action: 'confirm', pin: '1234' })).status, 503);
  assert.equal(update, undefined);
});
test('wrong PIN cannot change a report or create an audit event', async () => {
  assert.equal((await decide({ action: 'confirm', pin: 'wrong' })).status, 401);
  assert.equal(update, undefined); assert.equal(audit, undefined);
});
test('confirmation commits status and audit in the same transaction without storing the PIN', async () => {
  const response = await decide({ action: 'confirm', pin: 'test-pin', reason: 'Verified evidence' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reportId: id, status: 'confirmed_scam' });
  assert.deepEqual(update, { $set: { status: 'confirmed_scam' }, $unset: { expiresAt: '' } });
  assert.equal(audit?.action, 'confirm'); assert.equal(audit?.reason, 'Verified evidence');
  assert.equal(audit?.pin, undefined); assert.equal(committed, true); assert.equal(sessionEnded, true);
});
test('rejecting a report retains its existing expiry', async () => {
  assert.equal((await decide({ action: 'reject', pin: 'test-pin' })).status, 200);
  assert.deepEqual(update, { $set: { status: 'rejected' } });
});
test('unknown reports do not get audit events', async () => {
  matched = false;
  assert.equal((await decide({ action: 'confirm', pin: 'test-pin' })).status, 404);
  assert.equal(audit, undefined); assert.equal(sessionEnded, true);
});
test('audit failure does not report a committed decision and closes the session', async () => {
  auditFails = true;
  assert.equal((await decide({ action: 'confirm', pin: 'test-pin' })).status, 503);
  assert.equal(committed, false); assert.equal(sessionEnded, true);
});
