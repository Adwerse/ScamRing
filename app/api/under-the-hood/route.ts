import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getRing } from '@/lib/ring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!process.env.DB_NAME || !process.env.MONGODB_URI) return NextResponse.json({ available: false, message: 'Database connection is not configured. Set MONGODB_URI and DB_NAME to inspect live data.' });
  try {
    const db = await getDb();
    const names = ['reports', 'photos', 'scam_patterns', 'rent_baseline', 'checks', 'alerts'];
    const collections = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));
    const counts = Object.fromEntries(await Promise.all(names.map(async name => [name, collections.has(name) ? await db.collection(name).countDocuments({}, { maxTimeMS: 3000 }) : 0])));
    const indexes = (await Promise.all(names.filter(name => collections.has(name)).map(async name => (await db.collection(name).listIndexes().toArray()).map(index => ({ collection: name, name: index.name, keys: index.key }))))).flat();
    // Names from CONTRACT.md. This endpoint only inspects existing indexes.
    const searchDefinitions = [{ collection: 'reports', name: 'reports_text_vec' }, { collection: 'scam_patterns', name: 'patterns_vec' }];
    const searchIndexes = process.env.DB_NAME === 'scamring' ? (await Promise.all(searchDefinitions.filter(index => collections.has(index.collection)).map(async definition => {
      try {
        return (await db.collection(definition.collection).listSearchIndexes(definition.name).toArray()).map(index => {
          // The driver declares only `name`, although Atlas returns lifecycle fields.
          const details: { name: string; status?: unknown; queryable?: unknown } = index;
          return { collection: definition.collection, name: details.name, status: typeof details.status === 'string' ? details.status : 'UNKNOWN', queryable: details.queryable === true };
        });
      }
      catch { return []; }
    }))).flat() : [];
    const sample = collections.has('reports') ? await db.collection('reports').findOne({}, { projection: { _id: 1, identifiers: 1 }, maxTimeMS: 3000 }) : null;
    let ring;
    let scan;
    let ringPending = false;
    if (sample) {
      const result = await getRing(String(sample._id));
      const returnedIds = result.members.map(member => member._id);
      const storedIds = returnedIds.filter(id => /^[a-f\d]{24}$/i.test(id));
      const { ObjectId } = await import('mongodb');
      const storedCount = storedIds.length ? await db.collection('reports').countDocuments({ _id: { $in: storedIds.map(id => new ObjectId(id)) } }, { maxTimeMS: 3000 }) : 0;
      // Only present the traversal as live proof when every returned report is in this database.
      if (storedCount !== returnedIds.length) ringPending = true;
      else ring = { reports: result.members.length, sharedIdentifiers: result.sharedIdentifiers.length, confirmed: result.members.filter(member => member.status === 'confirmed_scam').length, maxHops: Math.max(0, ...result.members.map(member => member.hops)) };
      if (Array.isArray(sample.identifiers) && sample.identifiers.length) {
        const explained = await db.collection('reports').find({ identifiers: { $in: sample.identifiers } }).limit(60).maxTimeMS(3000).explain('executionStats');
        const findScan = (value: unknown): { stage: string; indexName: string | null } | undefined => {
          if (!value || typeof value !== 'object') return;
          const entry = value as Record<string, unknown>;
          if (typeof entry.stage === 'string' && (entry.stage.includes('IXSCAN') || entry.stage === 'COLLSCAN')) return { stage: entry.stage, indexName: typeof entry.indexName === 'string' ? entry.indexName : null };
          for (const child of Object.values(entry)) { const found = findScan(child); if (found) return found; }
        };
        const found = findScan(explained.queryPlanner?.winningPlan);
        scan = { stage: found?.stage ?? 'UNKNOWN', indexName: found?.indexName ?? null, keysExamined: explained.executionStats?.totalKeysExamined ?? 0, documentsExamined: explained.executionStats?.totalDocsExamined ?? 0 };
      }
    }
    return NextResponse.json({ available: true, empty: !sample, counts, indexes, searchIndexes, scan, ring, ringPending });
  } catch {
    // No connection strings, query values or database errors leave this route.
    return NextResponse.json({ available: false, message: 'The database could not be inspected. Check the connection configuration and try again.' });
  }
}
