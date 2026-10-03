import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.IDENTIFIER_SECRET ??= 'test-secret';

import { extractIdentifiers } from '../lib/identifiers';

const ids = (text: string) => extractIdentifiers(text).identifiers;

test('three spellings of one UK phone give the same identifier', () => {
  const a = ids('Call +44 7700 900123 now');
  const b = ids('Call 0044 7700 900 123 now');
  const c = ids('Call 07700900123 now');
  assert.equal(a.length, 1);
  assert.match(a[0], /^phone:[0-9a-f]{64}$/);
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
  assert.deepEqual(ids('Call +44 (0) 7700 900123'), a);
});

test('Irish mobiles: 08x and +353 spellings match', () => {
  const a = ids('Text 087 123 4567');
  assert.equal(a.length, 1);
  assert.deepEqual(ids('Text +353 87 123 4567'), a);
  assert.deepEqual(ids('Text 00353871234567'), a);
});

test('phone next to a price is still found; prices and dates are not phones', () => {
  assert.equal(ids('€650 087 123 4567').length, 1);
  assert.equal(ids('€1,200 per month, available 01/10/2026, deposit 1200').length, 0);
  assert.equal(ids('+1 415 555 0132').length, 1);
});

test('emails are lowercased and trimmed', () => {
  assert.deepEqual(ids('mail  John.Doe@Example.COM '), ids('john.doe@example.com'));
  assert.match(ids('a@b.ie')[0], /^email:/);
});

test('Revolut @handle and revolut.me/handle are the same pay identifier', () => {
  const a = ids('pay to @JohnD99 please');
  assert.equal(a.length, 1);
  assert.match(a[0], /^pay:/);
  assert.deepEqual(ids('https://revolut.me/johnd99'), a);
  assert.deepEqual(ids('revolut.me/@JohnD99'), a);
});

test('an email is not also read as a handle', () => {
  assert.deepEqual(
    extractIdentifiers('john@example.com').identifiers.map((i) => i.split(':')[0]),
    ['email'],
  );
});

test('IBANs: uppercase without spaces, not mistaken for phones', () => {
  const r = extractIdentifiers('send to ie29 aibk 9311 5212 3456 78 thanks');
  assert.deepEqual(r.identifiers.map((i) => i.split(':')[0]), ['iban']);
  assert.deepEqual(ids('IE29AIBK93115212345678'), r.identifiers);
});

test('hints are the last 2 characters of the normalised value; no raw value leaks', () => {
  const r = extractIdentifiers('07700900123 and John@Example.com');
  assert.deepEqual(r.hints, [
    { kind: 'email', hint: 'om' },
    { kind: 'phone', hint: '23' },
  ]);
  const dump = JSON.stringify(r);
  for (const raw of ['7700900123', 'example', 'john']) assert.ok(!dump.toLowerCase().includes(raw));
});

test('duplicates collapse; different numbers differ', () => {
  assert.equal(ids('087 123 4567 or +353871234567').length, 1);
  assert.notDeepEqual(ids('087 123 4567'), ids('087 123 4568'));
});

test('redactedText replaces every identifier and keeps the rest', () => {
  const r = extractIdentifiers('Call 087 123 4567 or john@example.com, pay @johnd99 / IE29 AIBK 9311 5212 3456 78. Rent €650.');
  assert.equal(r.redactedText, 'Call [phone] or [email], pay [pay] / [iban]. Rent €650.');
  assert.equal(extractIdentifiers('No contact here, 2 bed').redactedText, 'No contact here, 2 bed');
});
