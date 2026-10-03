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
  for (const id of ids) {
    if (id === confirmedReportId) continue;
    const verdict = await computeVerdict(id);
    await db
      .collection<Report>('reports')
      .updateOne({ _id: new ObjectId(id) }, { $set: { verdict } });
  }
  const alerts = db.collection<Alert>('alerts');
  await alerts.createIndex(
    { sessionId: 1, reportId: 1, triggerReportId: 1 },
    { unique: true },
  );
  const checks = await db
    .collection<Check>('checks')
    .aggregate<{ sessionId: string; reportId: ObjectId }>([
      { $match: { reportId: { $in: ids.map((id) => new ObjectId(id)) } } },
      { $group: { _id: { sessionId: '$sessionId', reportId: '$reportId' } } },
      { $project: { _id: 0, sessionId: '$_id.sessionId', reportId: '$_id.reportId' } },
    ])
    .toArray();
  const labels: Record<string, string> = {
    img: 'photo',
    phone: 'phone',
    email: 'email',
    pay: 'payment handle',
    iban: 'bank account',
  };
  const via =
    [
      ...new Set(
        (ring?.sharedIdentifiers ?? [])
          .map((id) => labels[id.split(':')[0]])
          .filter(Boolean),
      ),
    ].join(', ') || 'shared listing details';
  for (const check of checks) {
    try {
      await alerts.updateOne(
        { ...check, triggerReportId },
        {
          $setOnInsert: {
            _id: new ObjectId(),
            ...check,
            triggerReportId,
            message: `A listing you checked is linked to a confirmed scam (via ${via}).`,
            seen: false,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 11000))
        throw error;
    }
  }
  return checks.length;
}
