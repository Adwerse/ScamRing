// Owner: B
// GET /api/photos/[id]/thumb: the image hints written by ingest point here. Same JPEG as
// /api/photos/[id], which is already 640 px wide.
export { GET } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
