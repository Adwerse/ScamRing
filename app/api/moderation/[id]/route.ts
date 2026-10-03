// Owner: D (built by B)
// POST /api/moderation/[id]: a moderator confirms, rejects or clears a report. Needs MODERATOR_PIN.
// Writes a ModerationEvent; on confirm the change-stream worker fans out alerts, or this route
// does it inline when FANOUT_INLINE=1.
import { ObjectId } from 'mongodb';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { fanOut } from '@/lib/fanout';
import type { ModerationEvent, Report, ReportStatus } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const STATUS: Record<ModerationEvent['action'], ReportStatus> = {
  confirm: 'confirmed_scam',
  reject: 'rejected',
  legit: 'legit',
};

const Body = z.object({
  action: z.enum(['confirm', 'reject', 'legit']),
  pin: z.string(),
  reason: z.string().max(500).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!OBJECT_ID.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const expectedPin = process.env.MODERATOR_PIN;
  if (!expectedPin) return NextResponse.json({ error: 'moderation_disabled', hint: 'Set MODERATOR_PIN' }, { status: 503 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  if (parsed.data.pin !== expectedPin) return NextResponse.json({ error: 'wrong_pin' }, { status: 401 });

  const reportId = new ObjectId(id);
  const database = await getDb();
  const status = STATUS[parsed.data.action];
  const updated = await database
    .collection<Report>('reports')
    .updateOne({ _id: reportId }, { $set: { status }, $unset: { expiresAt: '' } });
  if (updated.matchedCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await database.collection<ModerationEvent>('moderation_events').insertOne({
    _id: new ObjectId(),
    reportId,
    action: parsed.data.action,
    by: 'moderator',
    ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    at: new Date(),
  });

  const inline = parsed.data.action === 'confirm' && process.env.FANOUT_INLINE === '1';
  const alerts = inline ? await fanOut(id) : undefined;
  return NextResponse.json({ reportId: id, status, ...(alerts === undefined ? {} : { alerts }) });
}
