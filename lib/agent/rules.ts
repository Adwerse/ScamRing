// Owner: A (AI moderator)
// Pure rules (no I/O) shared by the guardrail and the rule-based fallback of the AI moderator.
import type { RingMember } from '@/lib/ring';
import type { Report } from '@/lib/types';

export type RuleAction = 'confirm_scam' | 'legit' | 'reject';

export type RuleReport = {
  _id: { toString(): string };
  status: Report['status'];
  text: string;
  identifiers: string[];
  verdict?: Pick<NonNullable<Report['verdict']>, 'score' | 'signals'>;
};

export type RuleRing = { members: RingMember[] };

export type Evaluation = {
  eligible: Record<RuleAction, boolean>;
  /** Why an action is NOT eligible (empty when it is). */
  reasons: Record<RuleAction, string[]>;
  facts: {
    ringSize: number;
    areas: string[];
    sharedKinds: Record<string, number>;
    signalCodes: string[];
    score: number;
  };
};

const MIN_RING = 3;
const MAX_RING = 15;
const MIN_AREAS = 2;
const STRONG_KINDS = ['phone', 'pay', 'iban', 'img'];
const MIN_SHARING_REPORTS = 2;
const MIN_SIGNAL_CODES = 2;
const LEGIT_BELOW_SCORE = 10;
const MIN_TEXT = 20;

const kindOf = (identifier: string) => identifier.slice(0, identifier.indexOf(':'));

/** Per identifier kind: the most other ring reports sharing one single identifier of this report. */
function sharedKinds(report: RuleReport, others: RingMember[]): Record<string, number> {
  const kinds: Record<string, number> = {};
  for (const id of report.identifiers) {
    const count = others.filter((m) => m.identifiers.includes(id)).length;
    if (count > 0) kinds[kindOf(id)] = Math.max(kinds[kindOf(id)] ?? 0, count);
  }
  return kinds;
}

function confirmReasons(report: RuleReport, f: Evaluation['facts']): string[] {
  const reasons: string[] = [];
  if (report.status !== 'pending') reasons.push(`status is ${report.status}, not pending`);
  if (f.ringSize < MIN_RING) reasons.push(`the ring has ${f.ringSize} reports, at least ${MIN_RING} are needed`);
  if (f.ringSize > MAX_RING) reasons.push(`the ring has ${f.ringSize} reports, more than ${MAX_RING} looks like a hub, not a ring`);
  if (f.areas.length < MIN_AREAS) reasons.push(`the ring covers ${f.areas.length} area, at least ${MIN_AREAS} are needed`);
  if (!STRONG_KINDS.some((k) => (f.sharedKinds[k] ?? 0) >= MIN_SHARING_REPORTS)) {
    reasons.push(`no phone, payment handle, IBAN or photo is shared with at least ${MIN_SHARING_REPORTS} other reports (an email alone is not enough)`);
  }
  if (f.signalCodes.length < MIN_SIGNAL_CODES && !f.signalCodes.includes('photo_reuse')) {
    reasons.push(`the verdict has ${f.signalCodes.length} signal type, at least ${MIN_SIGNAL_CODES} (or photo_reuse) are needed`);
  }
  return reasons;
}

function legitReasons(report: RuleReport, f: Evaluation['facts']): string[] {
  const reasons: string[] = [];
  if (report.status !== 'pending') reasons.push(`status is ${report.status}, not pending`);
  if (!report.verdict) reasons.push('there is no verdict yet');
  if (f.score >= LEGIT_BELOW_SCORE) reasons.push(`the score is ${f.score}, it must be below ${LEGIT_BELOW_SCORE}`);
  if (f.signalCodes.length > 0) reasons.push('the verdict has signals');
  if (f.ringSize !== 1) reasons.push(`the ring has ${f.ringSize} reports, it must be exactly 1`);
  return reasons;
}

function rejectReasons(report: RuleReport, duplicateText: boolean): string[] {
  const reasons: string[] = [];
  if (report.status !== 'pending') reasons.push(`status is ${report.status}, not pending`);
  if (report.text.trim().length >= MIN_TEXT && !duplicateText) {
    reasons.push(`the text is ${report.text.trim().length} characters and not a duplicate: it looks like a real listing`);
  }
  return reasons;
}

export function evaluateReport(report: RuleReport, ring: RuleRing, extras: { duplicateText?: boolean } = {}): Evaluation {
  const self = report._id.toString();
  const others = ring.members.filter((m) => m._id !== self);
  const facts: Evaluation['facts'] = {
    ringSize: ring.members.length,
    areas: [...new Set(ring.members.map((m) => m.area))].sort(),
    sharedKinds: sharedKinds(report, others),
    signalCodes: [...new Set((report.verdict?.signals ?? []).map((s) => s.code))],
    score: report.verdict?.score ?? 0,
  };
  const reasons = {
    confirm_scam: confirmReasons(report, facts),
    legit: legitReasons(report, facts),
    reject: rejectReasons(report, extras.duplicateText ?? false),
  };
  return {
    eligible: { confirm_scam: reasons.confirm_scam.length === 0, legit: reasons.legit.length === 0, reject: reasons.reject.length === 0 },
    reasons,
    facts,
  };
}
