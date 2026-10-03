import { notImplemented } from '@/lib/stub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return notImplemented('GET /api/stream');
}
