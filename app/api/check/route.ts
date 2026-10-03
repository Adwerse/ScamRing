import { NextResponse, type NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { parseCheckRequest, RequestError } from '@/lib/checkInput';
import { getDb } from '@/lib/db';
import { ingestReport } from '@/lib/ingest';
import { getRing } from '@/lib/ring';
import type { Check } from '@/lib/types';
import { computeVerdict } from '@/lib/verdict';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function recordCheck(sessionId: string, reportId: ObjectId): Promise<void> {
  const db = await getDb();
  await db.collection<Check>('checks').insertOne({ _id: new ObjectId(), sessionId, reportId, createdAt: new Date() });
}

export async function POST(req: NextRequest) {
  try {
    const input = await parseCheckRequest(req);
    const report = await ingestReport(input);
    const verdict = await computeVerdict(report._id.toString());
    await recordCheck(req.cookies.get('sr_sid')?.value ?? uuidv4(), report._id);
    const { members } = await getRing(report._id.toString());
    return NextResponse.json({
      reportId: report._id.toString(),
      verdict,
      ring: { size: members.length, confirmedCount: members.filter((m) => m.status === 'confirmed_scam').length },
    });
  } catch (err) {
    if (err instanceof RequestError) return NextResponse.json({ error: err.message, issues: err.issues }, { status: err.status });
    console.error('POST /api/check failed', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
