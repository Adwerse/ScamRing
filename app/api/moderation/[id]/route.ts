import { timingSafeEqual } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getClient, getDb } from '@/lib/db';
import { fanOut } from '@/lib/fanout';
import type { Report, ReportStatus, ModerationEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  action: z.enum(['confirm', 'reject', 'legit']),
  by: z.string().trim().min(1).max(100),
  reason: z.string().trim().max(1000).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Demo-grade shared PIN; replace with moderator accounts before public release.
  const expected = Buffer.from(process.env.MODERATOR_PIN || '1234');
  const supplied = Buffer.from(request.headers.get('x-moderator-pin') || '');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return Response.json({ error: 'Invalid moderator PIN' }, { status: 403 });
  const { id } = await params;
  if (!/^[a-f\d]{24}$/i.test(id))
    return Response.json({ error: 'Invalid report id' }, { status: 400 });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return Response.json({ error: 'Invalid moderation action' }, { status: 400 });
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
            ...body.data,
            at: new Date(),
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    if (!found) return Response.json({ error: 'Report not found' }, { status: 404 });
    if (status === 'confirmed_scam' && process.env.FANOUT_INLINE === '1') {
      try {
        await fanOut(id);
      } catch {
        return Response.json(
          {
            status,
            alertDelivery: 'failed',
            error: 'Decision saved; alert delivery failed. Retry confirmation.',
          },
          { status: 503 },
        );
      }
    }
    return Response.json({ status });
  } catch {
    return Response.json(
      { error: 'Moderation unavailable. Check database configuration.' },
      { status: 503 },
    );
  }
}
