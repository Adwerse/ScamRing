// Typed access to the JSON fixtures in fixtures/. Stubs only; delete usages as real logic lands.
import reportJson from '@/fixtures/report.json';
import ringJson from '@/fixtures/ring.json';
import type { Verdict } from '@/lib/types';

export const reportFixture = reportJson;
export const ringFixture = ringJson;

export function verdictFixture(): Verdict {
  const v = reportJson.verdict;
  return {
    ...v,
    level: v.level as Verdict['level'],
    signals: v.signals as Verdict['signals'],
    computedAt: new Date(v.computedAt),
  };
}
