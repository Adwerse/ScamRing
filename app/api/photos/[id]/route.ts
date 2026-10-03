// Owner: B
// GET /api/photos/[id]: streams a photo's JPEG from photos_blob, which A's ingest fills.
// The blob document is looked up by its own _id or by photoId (the Photo _id), and the image is
// its first binary field, so the route does not depend on the blob field name.
import { Binary, ObjectId, type Document } from 'mongodb';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLLECTION = 'photos_blob';
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const DEFAULT_TYPE = 'image/jpeg';
const CACHE = 'public, max-age=86400, immutable';

function imageBytes(blob: Document): Uint8Array | null {
  for (const value of Object.values(blob)) {
    if (value instanceof Binary) return value.buffer;
  }
  return null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!OBJECT_ID.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  const photoId = new ObjectId(id);
  const database = await getDb();
  const blob = await database.collection(COLLECTION).findOne({ $or: [{ _id: photoId }, { photoId }] });
  const bytes = blob ? imageBytes(blob) : null;
  if (!blob || !bytes) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const contentType = typeof blob.contentType === 'string' ? blob.contentType : DEFAULT_TYPE;
  return new Response(Buffer.from(bytes), {
    headers: { 'Content-Type': contentType, 'Content-Length': String(bytes.byteLength), 'Cache-Control': CACHE },
  });
}
