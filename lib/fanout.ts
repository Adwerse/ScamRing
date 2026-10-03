import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { getRing } from '@/lib/ring';
import { computeVerdict } from '@/lib/verdict';
import type { Alert, Check, Report } from '@/lib/types';

type Linked = Pick<Report, '_id' | 'area' | 'priceEur' | 'status'>;

/** The confirmed report and every non-rejected report in its ring. */
async function linkedReports(confirmedReportId: string, memberIds?: string[]): Promise<Linked[]> {
  const db = await getDb();
  const ring = memberIds ? null : await getRing(confirmedReportId);
  const ids = [
    ...new Set([confirmedReportId, ...(memberIds ?? ring!.members.map((m) => m._id))]),
  ];
  return db.collection<Report>('reports')
    .find({ _id: { $in: ids.map((id) => new ObjectId(id)) }, status: { $ne: 'rejected' } },
      { projection: { area: 1, priceEur: 1, status: 1 } }).toArray();
}

/**
 * Recomputes the verdicts of the confirmed report's ring, so open report pages show the new
 * evidence. Runs after fanOut: each verdict can take seconds (embedding and summary calls), and
 * alerts must not wait for them. A failed verdict is logged and skipped.
 */
export async function refreshVerdicts(confirmedReportId: string, memberIds?: string[]): Promise<void> {
  for (const report of await linkedReports(confirmedReportId, memberIds)) {
    await computeVerdict(report._id.toString()).catch((error) => console.error('refreshVerdicts failed', report._id.toString(), error));
  }
}

/**
 * Alerts every session that checked the confirmed report or a report in its ring. Writes alerts
 * only, so delivery is not delayed by verdict recomputation; call refreshVerdicts afterwards.
 * Safe to retry after a worker restart or concurrent inline delivery.
 */
export async function fanOut(confirmedReportId: string, memberIds?: string[]) {
  const db = await getDb();
  const triggerReportId = new ObjectId(confirmedReportId);
  const linked = await linkedReports(confirmedReportId, memberIds);
  const byId = new Map(linked.map((report) => [report._id.toString(), report]));
  const alerts = db.collection<Alert>('alerts');
  await alerts.createIndex(
    { sessionId: 1, reportId: 1, triggerReportId: 1 },
    { unique: true },
  );
  const checks = await db
    .collection<Check>('checks')
    .aggregate<{ sessionId: string; reportId: ObjectId }>([
      { $match: { reportId: { $in: linked.map((report) => report._id) } } },
      { $group: { _id: { sessionId: '$sessionId', reportId: '$reportId' } } },
      { $project: { _id: 0, sessionId: '$_id.sessionId', reportId: '$_id.reportId' } },
    ])
    .toArray();
  let created = 0;
  for (const check of checks) {
    const checked = byId.get(check.reportId.toString())!;
    const description = checked.priceEur == null ? checked.area : `${checked.area}, €${checked.priceEur.toLocaleString('en-IE')}`;
    const message = check.reportId.equals(triggerReportId)
      ? `A listing you checked (${description}) was confirmed as a scam by a moderator.`
      : `A listing you checked (${description}) is linked to a scam confirmed by a moderator.`;
    try {
      const result = await alerts.updateOne(
        { ...check, triggerReportId },
        {
          $setOnInsert: {
            _id: new ObjectId(),
            ...check,
            triggerReportId,
            message,
            seen: false,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
      created += result.upsertedCount;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 11000))
        throw error;
    }
  }
  return created;
}
