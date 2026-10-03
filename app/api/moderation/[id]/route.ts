import { timingSafeEqual } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getClient, getDb } from '@/lib/db';
import { fanOut, refreshVerdicts } from '@/lib/fanout';
import type { Report, ReportStatus, ModerationEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  action: z.enum(['confirm', 'reject', 'legit']),
  pin: z.string(),
  reason: z.string().trim().max(1000).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const configuredPin = process.env.MODERATOR_PIN;
  if (!configuredPin)
    return Response.json({ error: 'moderation_disabled', hint: 'Set MODERATOR_PIN' }, { status: 503 });
  const { id } = await params;
  if (!/^[a-f\d]{24}$/i.test(id))
    return Response.json({ error: 'Invalid report id' }, { status: 400 });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return Response.json({ error: 'Invalid moderation action' }, { status: 400 });
  const expected = Buffer.from(configuredPin);
  const supplied = Buffer.from(body.data.pin);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return Response.json({ error: 'wrong_pin' }, { status: 401 });
  const statuses: Record<typeof body.data.action, ReportStatus> = {
    confirm: 'confirmed_scam',
    reject: 'rejected',
    legit: 'legit',
  };
  const status = statuses[body.data.action];
  try {
    const [client, db] = await Promise.all([getClient(), getDb()]);
    const session = client.startSession();
    let found = false;
    try {
      await session.withTransaction(async () => {
        const result = await db.collection<Report>('reports').updateOne(
          { _id: new ObjectId(id) },
          {
            $set: { status },
            ...(status === 'confirmed_scam' ? { $unset: { expiresAt: '' } } : {}),
          },
          { session },
        );
        found = result.matchedCount === 1;
        if (!found) return;
        await db.collection<ModerationEvent>('moderation_events').insertOne(
          {
            _id: new ObjectId(),
            reportId: new ObjectId(id),
            action: body.data.action,
            by: 'moderator',
            ...(body.data.reason ? { reason: body.data.reason } : {}),
            at: new Date(),
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    if (!found) return Response.json({ error: 'Report not found' }, { status: 404 });
    let alerts: number | undefined;
    if (status === 'confirmed_scam' && process.env.FANOUT_INLINE === '1') {
      try {
        alerts = await fanOut(id);
        // Respond as soon as alerts exist; verdicts update in the background.
        void refreshVerdicts(id);
      } catch {
        return Response.json(
          {
            reportId: id,
            status,
            alertDelivery: 'failed',
            error: 'Decision saved; alert delivery failed. Retry confirmation.',
          },
          { status: 503 },
        );
      }
    }
    return Response.json({ reportId: id, status, ...(alerts === undefined ? {} : { alerts }) });
  } catch {
    return Response.json(
      { error: 'Moderation unavailable. Check database configuration.' },
      { status: 503 },
    );
  }
}
