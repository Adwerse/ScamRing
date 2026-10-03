import { getDb } from '@/lib/db';
import { getRing } from '@/lib/ring';
import type { Report } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await getDb();
    const reports = await db
      .collection<Report>('reports')
      .find(
        { status: 'pending' },
        {
          projection: { area: 1, priceEur: 1, verdict: 1 },
        },
      )
      .sort({ 'verdict.score': -1, createdAt: -1 })
      .limit(50)
      .toArray();
    return Response.json(
      await Promise.all(
        reports.map(async (r) => ({
          _id: r._id.toString(),
          area: r.area,
          priceEur: r.priceEur,
          level: r.verdict?.level ?? null,
          signalTitles: r.verdict?.signals.map((s) => s.title) ?? [],
          ringSize: (await getRing(r._id.toString())).members.length,
        })),
      ),
    );
  } catch {
    return Response.json(
      { error: 'Moderation queue unavailable. Check database configuration.' },
      { status: 503 },
    );
  }
}
