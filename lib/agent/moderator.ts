// Owner: A (AI moderator)
// Reviews one pending report. The model reads data only through the read-only MongoDB MCP server
// (lib/agent/mcp.ts) and acts only through POST /api/moderation/[id], so the transaction, audit
// event, change stream and live alerts stay as they are. A code guardrail (lib/agent/rules.ts)
// checks every decision; if the model fails or never decides, a rule-based fallback runs.
// runModerator never throws.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { chat, LLM_TIMEOUT_MS, llmConfigured, modelName, type ChatMessage, type Completion, type ToolDef } from '@/lib/agent/llm';
import { openMcp, type Toolbox } from '@/lib/agent/mcp';
import { evaluateReport, type Evaluation, type RuleAction } from '@/lib/agent/rules';
import { getDb, getDbName } from '@/lib/db';
import { getRing, type RingMember } from '@/lib/ring';
import type { Report } from '@/lib/types';

export type Decision = RuleAction | 'skip';
export type AgentStep = { at: string; kind: 'model' | 'tool' | 'decision'; summary: string };
export type AgentResult = {
  reportId: string;
  decision: Decision;
  reason: string;
  steps: AgentStep[];
  usedFallback: boolean;
  model: string;
};

export type Context = { report: Report; ring: { members: RingMember[] }; duplicateText: boolean };
export type ApiOutcome = { ok: boolean; status: number; error?: string };
export type ApiBody = { action: 'confirm' | 'reject' | 'legit'; by: string; reason: string };

export type Deps = {
  llmReady: () => boolean;
  llm: (messages: ChatMessage[], tools: ToolDef[], timeoutMs: number) => Promise<Completion>;
  openMcp: (timeoutMs: number) => Promise<Toolbox>;
  load: (reportId: string) => Promise<Context | null>;
  pickPending: () => Promise<string | null>;
  callApi: (reportId: string, body: ApiBody) => Promise<ApiOutcome>;
  now: () => number;
};

const MAX_TURNS = 8;
const TOTAL_MS = 25000;
const REASON_MAX = 220;
const API_TIMEOUT_MS = 10000;
const MCP_START_MS = 20000;
const MODEL_ACTIONS: Decision[] = ['confirm_scam', 'reject', 'legit', 'skip'];
const API_ACTION: Record<RuleAction, ApiBody['action']> = { confirm_scam: 'confirm', reject: 'reject', legit: 'legit' };

const MODERATE_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'moderate',
    description: 'Record your final decision for the report under review. Call it exactly once, as your last step.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: MODEL_ACTIONS },
        reason: { type: 'string', description: `One plain sentence, at most ${REASON_MAX} characters, with no raw contact details.` },
      },
      required: ['action', 'reason'],
    },
  },
};

type Outcome = { decision: Decision; reason: string; by: string };

// ---- defaults for the real world -------------------------------------------------------------

async function loadContext(reportId: string): Promise<Context | null> {
  if (!/^[0-9a-f]{24}$/i.test(reportId)) return null;
  const reports = (await getDb()).collection<Report>('reports');
  const report = await reports.findOne({ _id: new ObjectId(reportId) });
  if (!report) return null;
  const [ring, duplicates] = await Promise.all([
    getRing(reportId),
    reports.countDocuments({ text: report.text, _id: { $ne: report._id } }),
  ]);
  return { report, ring, duplicateText: duplicates > 0 };
}

async function pickPending(): Promise<string | null> {
  const top = await (await getDb())
    .collection<Report>('reports')
    .find({ status: 'pending' }, { projection: { _id: 1 } })
    .sort({ 'verdict.score': -1, createdAt: -1 })
    .limit(1)
    .toArray();
  return top[0]?._id.toString() ?? null;
}

function apiCaller(baseUrl: string): Deps['callApi'] {
  return async (reportId, body) => {
    const pin = process.env.MODERATOR_PIN;
    if (!pin) return { ok: false, status: 0, error: 'MODERATOR_PIN is not set' };
    try {
      const response = await fetch(`${baseUrl}/api/moderation/${reportId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-moderator-pin': pin },
        // The route reads the PIN from the body and records by='moderator'; `by` is also put in the
        // reason so AI decisions stay recognisable in the audit trail.
        body: JSON.stringify({ action: body.action, pin, by: body.by, reason: `[${body.by}] ${body.reason}` }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (response.ok) return { ok: true, status: response.status };
      const detail = (await response.json().catch(() => ({}))) as { error?: string };
      return { ok: false, status: response.status, error: detail.error ?? `HTTP ${response.status}` };
    } catch (err) {
      return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

function defaultDeps(baseUrl: string): Deps {
  return {
    llmReady: llmConfigured,
    llm: chat,
    openMcp: (timeoutMs) =>
      openMcp({ dbName: getDbName(), connectionString: process.env.MDB_MCP_CONNECTION_STRING ?? '', timeoutMs }),
    load: loadContext,
    pickPending,
    callApi: apiCaller(baseUrl),
    now: Date.now,
  };
}

let promptCache: Promise<string> | undefined;
const systemPrompt = () => (promptCache ??= readFile(path.join(process.cwd(), 'lib/agent/system-prompt.md'), 'utf8'));

// ---- helpers --------------------------------------------------------------------------------

/** Short, safe text for the steps list: no identifier hashes, key or PIN. */
function clean(text: string): string {
  let out = text.replace(/\b(phone|email|pay|iban):[0-9a-f]{12,}/gi, '$1:…').replace(/\b[0-9a-f]{40,}\b/gi, '…');
  for (const secret of [process.env.TENSORX_API_KEY, process.env.MODERATOR_PIN]) if (secret) out = out.split(secret).join('***');
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > 200 ? `${out.slice(0, 199)}…` : out;
}

const truncate = (text: string) => text.trim().slice(0, REASON_MAX);

function factsLine(e: Evaluation): string {
  const f = e.facts;
  const shared = Object.entries(f.sharedKinds).map(([k, n]) => `${k} x${n}`).join(', ') || 'none';
  return `ring of ${f.ringSize} in ${f.areas.length} areas, shared ${shared}, signals ${f.signalCodes.join('+') || 'none'}`;
}

function parseArgs(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json || '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---- the run --------------------------------------------------------------------------------

type Run = { id: string; deps: Deps; log: (kind: AgentStep['kind'], summary: string) => void; model: string };

/** Applies a decision through the moderation API (or just records a skip). */
async function apply(run: Run, action: Decision, reason: string, by: string): Promise<Outcome> {
  if (action === 'skip') return { decision: 'skip', reason, by };
  const result = await run.deps.callApi(run.id, { action: API_ACTION[action], by, reason });
  if (result.ok) return { decision: action, reason, by };
  run.log('decision', `moderation API refused ${action}: ${result.error ?? result.status}`);
  return { decision: 'skip', reason: truncate(`Could not apply ${action} (${result.error ?? result.status}). Left for a human.`), by };
}

async function evaluateFresh(run: Run): Promise<{ ctx: Context; evaluation: Evaluation } | null> {
  const ctx = await run.deps.load(run.id);
  return ctx ? { ctx, evaluation: evaluateReport(ctx.report, ctx.ring, { duplicateText: ctx.duplicateText }) } : null;
}

/** The `moderate` tool: guardrail first, then the API. Returns a final outcome or text for the model. */
async function handleModerate(run: Run, args: Record<string, unknown>, state: { blocked: boolean }): Promise<{ final: Outcome } | { text: string }> {
  const action = args.action as Decision;
  if (!MODEL_ACTIONS.includes(action)) return { text: `error: action must be one of ${MODEL_ACTIONS.join(', ')}` };
  const reason = truncate(typeof args.reason === 'string' ? args.reason : '');
  if (!reason) return { text: 'error: reason is required' };
  const by = `ai-moderator:${run.model}`;
  if (action === 'skip') return { final: await apply(run, 'skip', reason, by) };
  const fresh = await evaluateFresh(run);
  if (!fresh || fresh.ctx.report.status !== 'pending') return { final: { decision: 'skip', reason: 'The report changed or is no longer pending.', by } };
  const rules = fresh.evaluation.reasons[action];
  if (rules.length > 0) {
    run.log('decision', `guardrail blocked ${action}: ${rules[0]}`);
    if (state.blocked) return { final: { decision: 'skip', reason: truncate(`Guardrail blocked ${action}: ${rules[0]}. Left for a human.`), by } };
    state.blocked = true;
    return { text: `blocked: ${rules.join('; ')}` };
  }
  return { final: await apply(run, action, reason, by) };
}

/** The model-driven path. Returns null when the model never decided (caller falls back). */
async function modelLoop(run: Run): Promise<Outcome | null> {
  const { deps } = run;
  const started = deps.now();
  const left = () => TOTAL_MS - (deps.now() - started);
  if (!deps.llmReady()) {
    run.log('model', 'LLM is not configured');
    return null;
  }
  const toolbox = await deps.openMcp(Math.min(MCP_START_MS, left()));
  try {
    run.log('tool', `MongoDB MCP ready (read-only): ${toolbox.tools.map((t) => t.function.name).join(', ')}`);
    const tools = [...toolbox.tools, MODERATE_TOOL];
    const messages: ChatMessage[] = [
      { role: 'system', content: await systemPrompt() },
      { role: 'user', content: `Review report ${run.id}.` },
    ];
    const state = { blocked: false };
    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      if (left() <= 0) {
        run.log('model', `stopped after ${TOTAL_MS / 1000}s`);
        return null;
      }
      const reply = await deps.llm(messages, tools, Math.min(LLM_TIMEOUT_MS, left()));
      run.log('model', reply.toolCalls.length > 0 ? `turn ${turn}: ${reply.toolCalls.map((c) => c.function.name).join(', ')}` : `turn ${turn}: replied without a decision`);
      messages.push({ role: 'assistant', content: reply.content, ...(reply.toolCalls.length > 0 ? { tool_calls: reply.toolCalls } : {}) });
      if (reply.toolCalls.length === 0) return null;
      for (const call of reply.toolCalls) {
        const args = parseArgs(call.function.arguments);
        let text: string;
        if (call.function.name === 'moderate') {
          const result = await handleModerate(run, args, state);
          if ('final' in result) return result.final;
          text = result.text;
          run.log('tool', `moderate: ${text.slice(0, 120)}`);
        } else {
          text = await toolbox.call(call.function.name, args);
          run.log('tool', `${call.function.name} ${JSON.stringify(args).slice(0, 100)} -> ${text.startsWith('error:') ? text.slice(0, 80) : `${Buffer.byteLength(text)} bytes`}`);
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: text });
      }
    }
    run.log('model', `no decision after ${MAX_TURNS} turns`);
    return null;
  } finally {
    await toolbox.close();
  }
}

/** Rule-based fallback: confirm only what the rules allow, otherwise skip. */
async function fallback(run: Run): Promise<Outcome> {
  const by = 'rules-fallback';
  const fresh = await evaluateFresh(run);
  if (!fresh || fresh.ctx.report.status !== 'pending') return { decision: 'skip', reason: 'The report changed or is no longer pending.', by };
  const { evaluation } = fresh;
  if (evaluation.eligible.confirm_scam) {
    return apply(run, 'confirm_scam', truncate(`Rules fallback: ${factsLine(evaluation)}.`), by);
  }
  return { decision: 'skip', reason: truncate(`Rules fallback: not enough evidence to confirm (${evaluation.reasons.confirm_scam[0]}). Left for a human.`), by };
}

export async function runModerator(opts: { reportId?: string; baseUrl?: string; deps?: Partial<Deps> } = {}): Promise<AgentResult> {
  const deps: Deps = { ...defaultDeps(opts.baseUrl || process.env.APP_BASE_URL || 'http://localhost:3000'), ...opts.deps };
  const model = modelName();
  const steps: AgentStep[] = [];
  const log: Run['log'] = (kind, summary) => steps.push({ at: new Date(deps.now()).toISOString(), kind, summary: clean(summary) });
  const finish = (reportId: string, o: Outcome, usedFallback: boolean): AgentResult => {
    log('decision', `${o.decision}: ${o.reason}`);
    return { reportId, decision: o.decision, reason: o.reason, steps, usedFallback, model };
  };
  let id = opts.reportId ?? '';
  try {
    id = opts.reportId ?? (await deps.pickPending()) ?? '';
    if (!id) return finish('', { decision: 'skip', reason: 'There are no pending reports to review.', by: 'none' }, false);
    const ctx = await deps.load(id);
    if (!ctx) return finish(id, { decision: 'skip', reason: 'Report not found.', by: 'none' }, false);
    if (ctx.report.status !== 'pending') return finish(id, { decision: 'skip', reason: `The report is already ${ctx.report.status}; the AI moderator only reviews pending reports.`, by: 'none' }, false);
    const run: Run = { id, deps, log, model };
    let outcome: Outcome | null = null;
    try {
      outcome = await modelLoop(run);
    } catch (err) {
      log('model', `LLM path failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (outcome) return finish(id, outcome, false);
    log('decision', 'using the rule-based fallback');
    return finish(id, await fallback(run), true);
  } catch (err) {
    return finish(id, { decision: 'skip', reason: truncate(`The AI moderator failed: ${err instanceof Error ? err.message : String(err)}`), by: 'none' }, true);
  }
}
