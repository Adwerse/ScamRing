import { NextResponse } from 'next/server';
import fixture from '@/fixtures/ring.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// STUB: returns fixtures/ring.json
export async function GET() {
  return NextResponse.json(fixture);
}
