// Owner: TBD
// STUB. Real version: returns a 'photo_reuse' Signal when the report's photos match other reports' photos (same clusterId, or LSH band hit then dhash Hamming distance).
// Catches its own errors and returns null.
import type { Report, Signal } from '@/lib/types';

export async function photoReuse(report: Report): Promise<Signal | null> {
  void report;
  return null;
}
