// Owner: D (built by B)
// GET /api/alerts: this session's alerts, newest first (cookie sr_sid).
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { Alert } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIMIT = 50;

export async function GET(request: Request) {
  const sessionId = (request.headers.get('cookie') ?? '').match(/(?:^|;\s*)sr_sid=([^;]+)/)?.[1];
  if (!sessionId) return NextResponse.json({ alerts: [] });
  const alerts = await (await getDb())
    .collection<Alert>('alerts')
    .find({ sessionId })
    .sort({ createdAt: -1 })
    .limit(LIMIT)
    .toArray();
  return NextResponse.json({
    alerts: alerts.map((alert) => ({
      ...alert,
      _id: alert._id.toString(),
      reportId: alert.reportId.toString(),
      triggerReportId: alert.triggerReportId.toString(),
    })),
  });
}
