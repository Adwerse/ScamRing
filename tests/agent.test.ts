import { config } from 'dotenv';
config({ path: '.env.local' });

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDbName } from '../lib/db';
import type { ChatMessage, Completion, ToolCall } from '../lib/agent/llm';
import { capBytes, guardCall, toolDefinition } from '../lib/agent/mcp';
import { runModerator, type ApiBody, type Context, type Deps } from '../lib/agent/moderator';
import { evaluateReport, type RuleReport } from '../lib/agent/rules';
import type { RingMember } from '../lib/ring';
import type { Report } from '../lib/types';

if (getDbName() === 'scamring') {
  console.error('Refusing to run: DB_NAME is the shared "scamring". Use a sandbox, e.g. DB_NAME=scamring_a.');
  process.exit(1);
}
process.env.TENSORX_MODEL = 'test-model';

// ---- hand-made rings ------------------------------------------------------------------------

const SELF = 'aaaaaaaaaaaaaaaaaaaaaaa0';
const AREAS = ['Dublin 1', 'Dublin 2', 'Dublin 6', 'Dublin 8'];
const signals = (...codes: string[]) => codes.map((code) => ({ code, points: 10, title: code, evidence: code, refs: [] }) as never);

function member(i: number, identifiers: string[], area = AREAS[i % AREAS.length]): RingMember {
  return { _id: i === 0 ? SELF : `bbbbbbbbbbbbbbbbbbbbbb${String(i).padStart(2, '0')}`, area, priceEur: 700, status: 'pending', hops: i === 0 ? 0 : 1, identifiers };
}

/** `size` reports, every one holding `shared`; the first is the report under review. */
function ring(size: number, shared: string[], areas = AREAS): { report: RuleReport; members: RingMember[] } {
  const members = Array.from({ length: size }, (_, i) => member(i, shared, areas[i % areas.length]));
  const report: RuleReport = {
    _id: SELF,
    status: 'pending',
    text: 'Lovely double room in Rathmines, bills included, available now. WhatsApp me.',
    identifiers: shared,
    verdict: { score: 60, signals: signals('ring_link', 'script_match', 'price_low') },
  };
  return { report, members };
}

const evaluate = (r: ReturnType<typeof ring>) => evaluateReport(r.report, { members: r.members });

// ---- evaluateReport -------------------------------------------------------------------------

test('confirm_scam is allowed for a ring-B shaped case (6 reports, 4 areas, shared pay, 3 signals)', () => {
  const e = evaluate(ring(6, ['pay:p1', 'email:e0']));
  assert.equal(e.eligible.confirm_scam, true, e.reasons.confirm_scam.join('; '));
  assert.deepEqual(e.facts.ringSize, 6);
  assert.equal(e.facts.areas.length, 4);
  assert.equal(e.facts.sharedKinds.pay, 5);
  assert.deepEqual(e.facts.signalCodes, ['ring_link', 'script_match', 'price_low']);
  assert.equal(e.facts.score, 60);
});

test('confirm_scam is blocked for a ring of 2', () => {
  const e = evaluate(ring(2, ['pay:p1']));
  assert.equal(e.eligible.confirm_scam, false);
  assert.match(e.reasons.confirm_scam.join(), /at least 3 are needed/);
});

test('confirm_scam is blocked when the only link is an email', () => {
  const e = evaluate(ring(6, ['email:e1']));
  assert.equal(e.eligible.confirm_scam, false);
  assert.match(e.reasons.confirm_scam.join(), /email alone is not enough/);
});

test('confirm_scam is blocked for a ring of 16, allowed for 15', () => {
  assert.equal(evaluate(ring(16, ['pay:p1'])).eligible.confirm_scam, false);
  assert.equal(evaluate(ring(15, ['pay:p1'])).eligible.confirm_scam, true);
});

test('confirm_scam is blocked when the status is not pending', () => {
  const r = ring(6, ['pay:p1']);
  const e = evaluateReport({ ...r.report, status: 'confirmed_scam' }, { members: r.members });
  assert.equal(e.eligible.confirm_scam, false);
  assert.equal(e.eligible.legit, false);
  assert.equal(e.eligible.reject, false);
  assert.match(e.reasons.confirm_scam[0], /not pending/);
});

test('confirm_scam needs at least 2 distinct areas, and 2 signal types or photo_reuse', () => {
  assert.equal(evaluate(ring(6, ['pay:p1'], ['Dublin 8'])).eligible.confirm_scam, false);
  const one = ring(6, ['pay:p1']);
  assert.equal(evaluateReport({ ...one.report, verdict: { score: 30, signals: signals('ring_link') } }, { members: one.members }).eligible.confirm_scam, false);
  assert.equal(evaluateReport({ ...one.report, verdict: { score: 35, signals: signals('photo_reuse') } }, { members: one.members }).eligible.confirm_scam, true);
});

test('legit: score below 10, no signals, ring of exactly 1', () => {
  const alone = ring(1, []);
  const clean: RuleReport = { ...alone.report, identifiers: [], verdict: { score: 0, signals: [] } };
  assert.equal(evaluateReport(clean, { members: alone.members }).eligible.legit, true);
  assert.equal(evaluateReport({ ...clean, verdict: { score: 10, signals: [] } }, { members: alone.members }).eligible.legit, false);
  assert.equal(evaluateReport({ ...clean, verdict: undefined }, { members: alone.members }).eligible.legit, false);
  assert.equal(evaluateReport(clean, { members: ring(2, ['pay:p1']).members }).eligible.legit, false);
});

test('reject: empty or very short text, or an exact duplicate; not a normal listing', () => {
  const r = ring(1, []);
  const rejectable = (text: string, duplicateText = false) => evaluateReport({ ...r.report, text }, { members: r.members }, { duplicateText }).eligible.reject;
  assert.equal(rejectable(''), true);
  assert.equal(rejectable('  hi there  '), true);
  assert.equal(rejectable('Lovely double room in Rathmines, available now.'), false);
  assert.equal(rejectable('Lovely double room in Rathmines, available now.', true), true);
});

// ---- the moderator with a stubbed model, MCP and API -----------------------------------------

function context(r: ReturnType<typeof ring>): Context {
  return { report: { ...r.report, _id: SELF, seed: false } as unknown as Report, ring: { members: r.members }, duplicateText: false };
}

const call = (name: string, args: unknown, id = `call-${name}`): ToolCall => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const toolTurn = (...calls: ToolCall[]): Completion => ({ content: null, toolCalls: calls });

function harness(ctx: Context, llm: Deps['llm'], extra: Partial<Deps> = {}) {
  const apiCalls: ApiBody[] = [];
  const mcpCalls: string[] = [];
  const deps: Partial<Deps> = {
    llmReady: () => true,
    llm,
    openMcp: async () => ({
      tools: [{ type: 'function', function: { name: 'find', description: 'find', parameters: { type: 'object', properties: {} } } }],
      call: async (name) => (mcpCalls.push(name), '{"ok":true}'),
      close: async () => undefined,
    }),
    load: async () => ctx,
    pickPending: async () => SELF,
    callApi: async (_id, body) => (apiCalls.push(body), { ok: true, status: 200 }),
    ...extra,
  };
  return { deps, apiCalls, mcpCalls };
}

test('a model that asks to confirm a blocked report is told "blocked:" once, then forced to skip', async () => {
  const seen: ChatMessage[][] = [];
  const { deps, apiCalls } = harness(context(ring(2, ['pay:p1'])), async (messages) => {
    seen.push(structuredClone(messages));
    return toolTurn(call('moderate', { action: 'confirm_scam', reason: 'looks bad' }));
  });
  const result = await runModerator({ reportId: SELF, deps });
  assert.equal(result.decision, 'skip');
  assert.equal(result.usedFallback, false);
  assert.equal(apiCalls.length, 0);
  assert.equal(seen.length, 2, 'the model was asked twice');
  const lastTool = seen[1].filter((m) => m.role === 'tool').pop();
  assert.match(lastTool?.content ?? '', /^blocked: /);
  assert.match(result.reason, /Guardrail blocked confirm_scam/);
});

test('a failing LLM triggers the rules fallback (confirm when eligible, skip otherwise)', async () => {
  const failing: Deps['llm'] = async () => {
    throw new Error('LLM request failed: HTTP 401');
  };
  const eligible = harness(context(ring(6, ['pay:p1'])), failing);
  const confirmed = await runModerator({ reportId: SELF, deps: eligible.deps });
  assert.equal(confirmed.usedFallback, true);
  assert.equal(confirmed.decision, 'confirm_scam');
  assert.equal(eligible.apiCalls.length, 1);
  assert.equal(eligible.apiCalls[0].action, 'confirm');
  assert.equal(eligible.apiCalls[0].by, 'rules-fallback');

  const blocked = harness(context(ring(2, ['pay:p1'])), failing);
  const skipped = await runModerator({ reportId: SELF, deps: blocked.deps });
  assert.equal(skipped.usedFallback, true);
  assert.equal(skipped.decision, 'skip');
  assert.equal(blocked.apiCalls.length, 0);
});

test('a model that never calls moderate, or whose MCP server will not start, falls back', async () => {
  const chatty = harness(context(ring(6, ['pay:p1'])), async () => ({ content: 'I think it is a scam.', toolCalls: [] }));
  assert.equal((await runModerator({ reportId: SELF, deps: chatty.deps })).usedFallback, true);
  const noMcp = harness(context(ring(6, ['pay:p1'])), async () => toolTurn(call('moderate', { action: 'skip', reason: 'x' })), {
    openMcp: async () => {
      throw new Error('spawn npx ENOENT');
    },
  });
  const result = await runModerator({ reportId: SELF, deps: noMcp.deps });
  assert.equal(result.usedFallback, true);
  assert.ok(result.steps.some((s) => s.summary.includes('LLM path failed')));
});

test('an allowed confirm goes through the API as "confirm", by ai-moderator:<model>, reason cut to 220', async () => {
  let turn = 0;
  const { deps, apiCalls, mcpCalls } = harness(context(ring(6, ['pay:p1'])), async () =>
    ++turn === 1
      ? toolTurn(call('find', { collection: 'reports', filter: {} }))
      : toolTurn(call('moderate', { action: 'confirm_scam', reason: 'x'.repeat(300) })),
  );
  const result = await runModerator({ reportId: SELF, deps });
  assert.equal(result.decision, 'confirm_scam');
  assert.equal(result.usedFallback, false);
  assert.equal(result.model, 'test-model');
  assert.deepEqual(mcpCalls, ['find']);
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].action, 'confirm');
  assert.equal(apiCalls[0].by, 'ai-moderator:test-model');
  assert.equal(apiCalls[0].reason.length, 220);
  assert.ok(result.steps.some((s) => s.kind === 'tool') && result.steps.some((s) => s.kind === 'decision'));
});

test('skip makes no API call; non-pending reports are not reviewed; API failure ends as skip', async () => {
  const skip = harness(context(ring(6, ['pay:p1'])), async () => toolTurn(call('moderate', { action: 'skip', reason: 'unsure' })));
  const skipped = await runModerator({ reportId: SELF, deps: skip.deps });
  assert.equal(skipped.decision, 'skip');
  assert.equal(skip.apiCalls.length, 0);

  const done = context(ring(6, ['pay:p1']));
  done.report.status = 'confirmed_scam';
  const closed = harness(done, async () => assert.fail('the model must not be called'));
  assert.equal((await runModerator({ reportId: SELF, deps: closed.deps })).decision, 'skip');

  const broken = harness(context(ring(6, ['pay:p1'])), async () => toolTurn(call('moderate', { action: 'confirm_scam', reason: 'ok' })), {
    callApi: async () => ({ ok: false, status: 401, error: 'wrong_pin' }),
  });
  const refused = await runModerator({ reportId: SELF, deps: broken.deps });
  assert.equal(refused.decision, 'skip');
  assert.match(refused.reason, /wrong_pin/);
});

test('steps never contain identifier hashes or the API key', async () => {
  process.env.TENSORX_API_KEY = 'sk-test-secret-key';
  const hash = 'a'.repeat(64);
  const { deps } = harness(context(ring(6, ['pay:p1'])), async () => toolTurn(call('moderate', { action: 'skip', reason: `pay:${hash} sk-test-secret-key` })));
  const result = await runModerator({ reportId: SELF, deps });
  delete process.env.TENSORX_API_KEY;
  const dump = JSON.stringify(result.steps);
  assert.ok(!dump.includes(hash) && !dump.includes('sk-test-secret-key'));
});

// ---- the MCP guard --------------------------------------------------------------------------

test('guardCall forces the database and connection, and only lets the three collections through', () => {
  const ok = guardCall('find', { collection: 'reports', filter: { status: 'pending' }, database: 'scamring' }, 'scamring_a', 'preconfigured');
  assert.ok('args' in ok && ok.args.database === 'scamring_a' && ok.args.connectionId === 'preconfigured');
  for (const collection of ['photos', 'checks', 'alerts', 'photos_blob', 'moderation_events']) {
    assert.ok('error' in guardCall('count', { collection }, 'scamring_a', 'c'), collection);
  }
  assert.ok('error' in guardCall('find', {}, 'scamring_a', 'c'));
  assert.ok('args' in guardCall('list-collections', {}, 'scamring_a', 'c'));
  assert.ok('args' in guardCall('collection-schema', { collection: 'scam_patterns' }, 'scamring_a', 'c'));
});

test('guardCall rejects other tools, other collections inside pipelines, writes and server-side JS', () => {
  for (const name of ['connect', 'drop-collection', 'insert-many', 'update-many', 'delete-many', 'aggregate-db', 'list-databases']) {
    assert.ok('error' in guardCall(name, { collection: 'reports' }, 'scamring_a', 'c'), name);
  }
  const agg = (pipeline: unknown) => guardCall('aggregate', { collection: 'reports', pipeline }, 'scamring_a', 'c');
  assert.ok('args' in agg([{ $match: { status: 'pending' } }, { $lookup: { from: 'scam_patterns', localField: 'a', foreignField: 'b', as: 'x' } }]));
  assert.ok('args' in agg([{ $graphLookup: { from: 'reports', startWith: '$identifiers', connectFromField: 'identifiers', connectToField: 'identifiers', as: 'ring' } }]));
  assert.ok('error' in agg([{ $lookup: { from: 'photos', localField: 'a', foreignField: 'b', as: 'x' } }]));
  assert.ok('error' in agg([{ $facet: { x: [{ $lookup: { from: 'checks', pipeline: [], as: 'y' } }] } }]));
  assert.ok('error' in agg([{ $unionWith: 'alerts' }]));
  assert.ok('error' in agg([{ $out: 'reports' }]));
  assert.ok('error' in agg([{ $merge: { into: 'reports' } }]));
  assert.ok('error' in agg([{ $match: { $where: 'sleep(1000)' } }]));
  assert.ok('error' in agg('not an array'));
});

test('capBytes caps results at the limit, toolDefinition hides the forced arguments', () => {
  assert.equal(capBytes('short', 20000), 'short');
  const capped = capBytes('é'.repeat(30000), 20000);
  assert.ok(Buffer.byteLength(capped) <= 20000 + 60 && capped.includes('[truncated'));
  const def = toolDefinition({
    name: 'find',
    description: 'Run a find query',
    inputSchema: { type: 'object', properties: { connectionId: {}, database: {}, collection: {}, filter: {}, responseBytesLimit: {} }, required: ['connectionId', 'database', 'collection'], $schema: 'x' },
  });
  assert.equal(def.type, 'function');
  assert.deepEqual(Object.keys(def.function.parameters.properties as object), ['collection', 'filter']);
  assert.deepEqual(def.function.parameters.required, ['collection']);
  assert.ok(!('$schema' in def.function.parameters));
});
