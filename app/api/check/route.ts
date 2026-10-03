import { NextResponse } from 'next/server';
import fixture from '@/fixtures/check-response.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// STUB: returns fixtures/check-response.json. The request body is accepted and ignored.
export async function POST() {
  return NextResponse.json(fixture);
}
