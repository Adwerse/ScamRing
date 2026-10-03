// Owner: A
// Runs every signal in lib/signals (each catches its own errors; allSettled is a second net),
// sums the points (capped at 100), maps the score to a level, writes a short summary and
// stores the Verdict on the report.
import Anthropic from '@anthropic-ai/sdk';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { signals } from '@/lib/signals';
import type { Report, Signal, Verdict } from '@/lib/types';

const MAX_SCORE = 100;
const HIGH_FROM = 70;
const MEDIUM_FROM = 30;
const SUMMARY_MAX_WORDS = 60;
const SUMMARY_TIMEOUT_MS = 3000;
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT =
  `You help students renting in Ireland. Using ONLY the warning signals you are given, explain in at most ${SUMMARY_MAX_WORDS} plain words ` +
  'why the listing may be risky. Make no legal claims, never say or imply that anyone is guilty or that the listing is certainly a scam, ' +
  'and do not mention being an AI. Reply with the explanation only.';

function levelOf(score: number): Verdict['level'] {
  return score >= HIGH_FROM ? 'HIGH' : score >= MEDIUM_FROM ? 'MEDIUM' : 'LOW';
}

async function runSignals(report: Report): Promise<Signal[]> {
  const settled = await Promise.allSettled(signals.map((signal) => signal(report)));
  const found: Signal[] = [];
  for (const result of settled) {
    if (result.status === 'rejected') console.error('signal failed', result.reason);
    else if (result.value) found.push(result.value);
  }
  return found.sort((a, b) => b.points - a.points);
}

function templateSummary(level: Verdict['level'], found: Signal[]): string {
  const name = level[0] + level.slice(1).toLowerCase();
  if (found.length === 0) return `${name} risk: no warning signs found in the reports we hold. Still view in person before paying anything.`;
  return `${name} risk: ${found.map((s) => s.title).join('; ')}.`;
}

/** At most SUMMARY_MAX_WORDS words, cut at the last full sentence when it has to be shortened. */
function limitWords(text: string): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= SUMMARY_MAX_WORDS) return words.join(' ');
  const cut = words.slice(0, SUMMARY_MAX_WORDS).join(' ');
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return lastStop > 0 ? cut.slice(0, lastStop + 1) : cut;
}

/** Sends ONLY the signal titles and evidence (never the listing text). */
async function modelSummary(level: Verdict['level'], found: Signal[]): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: SUMMARY_TIMEOUT_MS });
  const lines = found.map((s) => `- ${s.title}: ${s.evidence}`).join('\n');
  const message = await client.messages.create(
    {
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Risk level: ${level}\nWarning signals:\n${lines}` }],
    },
    { timeout: SUMMARY_TIMEOUT_MS },
  );
  const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('').trim();
  if (!text) throw new Error('empty summary');
  return limitWords(text);
}

async function summarise(level: Verdict['level'], found: Signal[]): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY || found.length === 0) return templateSummary(level, found);
  try {
    return await modelSummary(level, found);
  } catch (err) {
    console.error('summary model failed, using template', err instanceof Error ? err.message : err);
    return templateSummary(level, found);
  }
}

export async function computeVerdict(reportId: string): Promise<Verdict> {
  const reports = (await getDb()).collection<Report>('reports');
  const report = await reports.findOne({ _id: new ObjectId(reportId) });
  if (!report) throw new Error(`report ${reportId} not found`);
  const found = await runSignals(report);
  const score = Math.min(MAX_SCORE, found.reduce((sum, s) => sum + s.points, 0));
  const level = levelOf(score);
  const verdict: Verdict = { score, level, signals: found, summary: await summarise(level, found), computedAt: new Date() };
  await reports.updateOne({ _id: report._id }, { $set: { verdict } });
  return verdict;
}
