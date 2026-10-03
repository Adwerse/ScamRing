import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { getRing } from '@/lib/ring';
import { computeVerdict } from '@/lib/verdict';
import type { Alert, Check, Report } from '@/lib/types';

/** Safe to retry after a worker restart or concurrent inline delivery. */
export async function fanOut(confirmedReportId: string, memberIds?: string[]) {
  const db = await getDb();
  const triggerReportId = new ObjectId(confirmedReportId);
  const ring = memberIds ? null : await getRing(confirmedReportId);
  const ids = [
    ...new Set([confirmedReportId, ...(memberIds ?? ring!.members.map((m) => m._id))]),
  ];
  const linked = await db.collection<Report>('reports')
    .find({ _id: { $in: ids.map((id) => new ObjectId(id)) }, status: { $ne: 'rejected' } },
      { projection: { area: 1, priceEur: 1, status: 1 } }).toArray();
  const byId = new Map(linked.map((report) => [report._id.toString(), report]));
  for (const report of linked) await computeVerdict(report._id.toString());
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
