// Owner: D (built by B)
// After a moderator confirms a scam: alert every session that checked a listing in the confirmed
// report's ring, then recompute the ring's verdicts so open report pages show the new evidence.
// One alert per session and confirmed report, however often fan-out runs for it.
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { getRing } from '@/lib/ring';
import type { Alert, Check, Report } from '@/lib/types';
import { computeVerdict } from '@/lib/verdict';

type Linked = Pick<Report, '_id' | 'area' | 'priceEur' | 'status'>;

function describe(report: Linked): string {
  return report.priceEur === null ? report.area : `${report.area}, €${report.priceEur.toLocaleString('en-IE')}`;
}

function message(checked: Linked, confirmedId: ObjectId): string {
  return checked._id.equals(confirmedId)
    ? `A listing you checked (${describe(checked)}) was just confirmed as a scam by a moderator.`
    : `A listing you checked (${describe(checked)}) is linked to a scam just confirmed by a moderator.`;
}

/**
 * Alerts sessions that checked the confirmed report or any report in its ring, and recomputes
 * those reports' verdicts. `memberIds` overrides the ring (for testing). Returns alerts created.
 */
export async function fanOut(confirmedReportId: string, memberIds?: string[]): Promise<number> {
  const confirmedId = new ObjectId(confirmedReportId);
  const ids = memberIds ?? (await getRing(confirmedReportId)).members.map((member) => member._id);
  const linkedIds = [...new Set([confirmedReportId, ...ids])].map((id) => new ObjectId(id));
  const database = await getDb();
  const linked = await database
    .collection<Report>('reports')
    .find({ _id: { $in: linkedIds } }, { projection: { area: 1, priceEur: 1, status: 1 } })
    .toArray();
  const byId = new Map(linked.map((report) => [report._id.toString(), report as Linked]));
  const checks = await database
    .collection<Check>('checks')
    .find({ reportId: { $in: linkedIds } })
    .sort({ createdAt: -1 })
    .toArray();

  let created = 0;
  const alerted = new Set<string>();
  for (const check of checks) {
    if (alerted.has(check.sessionId)) continue;
    alerted.add(check.sessionId);
    const checked = byId.get(check.reportId.toString());
    if (!checked) continue;
    const result = await database.collection<Alert>('alerts').updateOne(
      { sessionId: check.sessionId, triggerReportId: confirmedId },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          sessionId: check.sessionId,
          reportId: check.reportId,
          triggerReportId: confirmedId,
          message: message(checked, confirmedId),
          seen: false,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
    created += result.upsertedCount;
  }

  for (const report of linked) {
    if (report.status === 'rejected') continue;
    await computeVerdict(report._id.toString()).catch((error) => console.error('fanOut verdict failed', error));
  }
  return created;
}
