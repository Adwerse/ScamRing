import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import type { Alert } from '@/lib/types';
import { ObjectId } from 'mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const sid = (await cookies()).get('sr_sid')?.value;
  if (!sid) return Response.json({ error: 'Session required' }, { status: 401 });
  const value = new URL(request.url).searchParams.get('since');
  const since = value ? new Date(value) : new Date(0);
  if (Number.isNaN(since.getTime()))
    return Response.json({ error: 'Invalid since timestamp' }, { status: 400 });
  const after = new URL(request.url).searchParams.get('after');
  if (after && !/^[a-f\d]{24}$/i.test(after))
    return Response.json({ error: 'Invalid alert cursor' }, { status: 400 });
  try {
    const db = await getDb();
    const cursor = after
      ? {
          $or: [
            { createdAt: { $gt: since } },
            { createdAt: since, _id: { $gt: new ObjectId(after) } },
          ],
        }
      : { createdAt: { $gte: since } };
    const alerts = await db
      .collection<Alert>('alerts')
      .find({ sessionId: sid, ...cursor })
      .sort({ createdAt: 1, _id: 1 })
      .limit(100)
      .toArray();
    return Response.json(alerts, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Alerts unavailable' }, { status: 503 });
  }
}
