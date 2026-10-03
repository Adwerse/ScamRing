import { NextResponse } from 'next/server';
import fixture from '@/fixtures/report.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// STUB: returns fixtures/report.json
export async function GET() {
  return NextResponse.json(fixture);
}
