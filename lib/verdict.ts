// Owner: TBD
// STUB. Real version: loads the report, runs every function in lib/signals (each catches its
// own errors and returns null), sums points into a 0-100 score, maps it to LOW/MEDIUM/HIGH,
// writes a short summary (Claude if ANTHROPIC_API_KEY is set, template otherwise) and stores
// the Verdict on the report.
import { verdictFixture } from '@/lib/fixtures';
import type { Verdict } from '@/lib/types';

export async function computeVerdict(reportId: string): Promise<Verdict> {
  void reportId;
  return verdictFixture();
}
