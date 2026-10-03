// Owner: A (AI moderator)
// POST /api/moderation/agent: runs the AI moderator on one pending report (or the top of the queue).
// Needs the x-moderator-pin header. One run at a time: a second request gets 409.
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runModerator } from '@/lib/agent/moderator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ reportId: z.string().regex(/^[0-9a-f]{24}$/i).optional() });

let running = false;

function pinMatches(supplied: string | null, expected: string): boolean {
  const a = Buffer.from(supplied ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expectedPin = process.env.MODERATOR_PIN;
  if (!expectedPin) return NextResponse.json({ error: 'moderation_disabled', hint: 'Set MODERATOR_PIN' }, { status: 503 });
  if (!pinMatches(request.headers.get('x-moderator-pin'), expectedPin)) return NextResponse.json({ error: 'wrong_pin' }, { status: 401 });
  const body = Body.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  if (running) return NextResponse.json({ error: 'agent_busy' }, { status: 409 });
  running = true;
  try {
    const baseUrl = process.env.APP_BASE_URL || new URL(request.url).origin;
    return NextResponse.json(await runModerator({ reportId: body.data.reportId, baseUrl }));
  } finally {
    running = false;
  }
}
