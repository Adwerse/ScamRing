import { NextResponse } from 'next/server';

export function notImplemented(route: string) {
  return NextResponse.json({ error: 'not_implemented', route }, { status: 501 });
}
