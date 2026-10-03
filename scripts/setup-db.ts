import { config } from 'dotenv';
config({ path: '.env.local' });

import type { Collection, Db, Document, IndexSpecification } from 'mongodb';
import { getClient, getDb, getDbName } from '../lib/db';
import { vectorSearchStage } from '../lib/vector';

const SHARED_DB = 'scamring';
const POLL_MS = 5000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const COLLECTIONS = [
  'reports',
  'photos',
  'photos_blob',
  'scam_patterns',
  'rent_baseline',
  'checks',
  'alerts',
  'moderation_events',
  'meta',
];

type IndexDef = { key: IndexSpecification; options?: { name?: string; expireAfterSeconds?: number } };

const INDEXES: Record<string, IndexDef[]> = {
  reports: [
    { key: { identifiers: 1 }, options: { name: 'identifiers_1' } },
    { key: { status: 1, createdAt: -1 } },
    { key: { area: 1, kind: 1, bedrooms: 1 } },
    { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  ],
  photos: [
    { key: { b0: 1 } },
    { key: { b1: 1 } },
    { key: { b2: 1 } },
    { key: { b3: 1 } },
    { key: { clusterId: 1 } },
    { key: { reportId: 1 } },
  ],
  checks: [{ key: { reportId: 1 } }, { key: { sessionId: 1 } }],
  alerts: [{ key: { sessionId: 1, createdAt: -1 } }],
  rent_baseline: [{ key: { location: 1, bedrooms: 1, propertyType: 1, quarter: -1 } }],
  moderation_events: [{ key: { reportId: 1, at: -1 } }],
};

type SearchIndexDef = { collection: string; name: string; type: 'vectorSearch'; definition: Document };

// An M0 cluster allows only 3 search indexes in total: create exactly these two.
const SEARCH_INDEXES: SearchIndexDef[] = [
  {
    collection: 'reports',
    name: 'reports_text_vec',
    type: 'vectorSearch',
    definition: {
      fields: [
        { type: 'autoEmbed', modality: 'text', path: 'text', model: 'voyage-4' },
        { type: 'filter', path: 'status' },
      ],
    },
  },
  {
    collection: 'scam_patterns',
    name: 'patterns_vec',
    type: 'vectorSearch',
    definition: {
      fields: [
        { type: 'autoEmbed', modality: 'text', path: 'text', model: 'voyage-4' },
        { type: 'filter', path: 'category' },
      ],
    },
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureCollections(db: Db): Promise<void> {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const name of COLLECTIONS) {
    if (existing.has(name)) continue;
    await db.createCollection(name);
    console.log(`created collection ${name}`);
  }
}

async function ensureIndexes(db: Db): Promise<void> {
  for (const [name, defs] of Object.entries(INDEXES)) {
    for (const d of defs) await db.collection(name).createIndex(d.key, d.options ?? {});
  }
  console.log('b-tree indexes ensured');
}

async function searchIndexExists(coll: Collection, name: string): Promise<boolean> {
  return (await coll.listSearchIndexes(name).toArray()).length > 0;
}

async function ensureSearchIndexes(db: Db): Promise<void> {
  for (const s of SEARCH_INDEXES) {
    const coll = db.collection(s.collection);
    try {
      if (await searchIndexExists(coll, s.name)) {
        console.log(`search index ${s.name} already exists`);
        continue;
      }
      await coll.createSearchIndex({ name: s.name, type: s.type, definition: s.definition });
      console.log(`created search index ${s.name}`);
    } catch (err) {
      console.log(`createSearchIndex rejected for ${s.name}: ${(err as Error).message}`);
      console.log(`Create it in the Atlas UI (Search and Vector Search, JSON editor) on ${s.collection} as "${s.name}":`);
      console.log(JSON.stringify(s.definition, null, 2));
    }
  }
}

async function waitQueryable(db: Db): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (true) {
    const status = await Promise.all(
      SEARCH_INDEXES.map(async (s) => {
        const [idx] = (await db.collection(s.collection).listSearchIndexes(s.name).toArray()) as Document[];
        return { name: s.name, status: idx?.status ?? 'MISSING', queryable: idx?.queryable === true };
      }),
    );
    console.log(status.map((s) => `${s.name}: ${s.status}${s.queryable ? ' (queryable)' : ''}`).join(' | '));
    if (status.every((s) => s.queryable)) return;
    if (Date.now() > deadline) throw new Error('timed out waiting for search indexes to be queryable');
    await sleep(POLL_MS);
  }
}

const TEST_TEXTS = [
  'Landlord is abroad and asks you to pay a deposit by bank transfer before you can view the flat.',
  'Everyone is invited to a mass viewing; the first to send the deposit gets the keys.',
];

function testPattern(text: string, i: number): Document {
  return {
    code: `test_${i}`,
    category: 'absent_landlord',
    title: `seed test ${i}`,
    text,
    advice: 'test',
    sourceUrl: 'https://example.com',
    seedTest: true,
  };
}

async function vectorSmokeTest(db: Db): Promise<void> {
  const coll = db.collection('scam_patterns');
  await coll.deleteMany({ seedTest: true });
  try {
    await coll.insertMany(TEST_TEXTS.map(testPattern));
    const pipeline = [
      vectorSearchStage({ index: 'patterns_vec', path: 'text', text: 'deposit before viewing, landlord abroad', limit: 3 }),
      { $project: { _id: 0, code: 1, text: 1, seedTest: 1, score: { $meta: 'vectorSearchScore' } } },
    ];
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (true) {
      const hits = (await coll.aggregate(pipeline).toArray()).filter((h) => h.seedTest);
      if (hits.length === TEST_TEXTS.length) {
        for (const h of hits) console.log(`  score ${Number(h.score).toFixed(4)}  ${h.code}: ${String(h.text).slice(0, 60)}`);
        return;
      }
      if (Date.now() > deadline) throw new Error('vector search never returned the test docs');
      console.log(`waiting for embeddings (${hits.length}/${TEST_TEXTS.length} test docs searchable)`);
      await sleep(POLL_MS);
    }
  } finally {
    const { deletedCount } = await coll.deleteMany({ seedTest: true });
    console.log(`removed ${deletedCount} seedTest docs`);
  }
}

async function printIndexes(db: Db): Promise<void> {
  for (const name of COLLECTIONS) {
    const idx = await db.collection(name).indexes();
    console.log(`${name}:`);
    for (const i of idx) console.log(`  ${i.name}  ${JSON.stringify(i.key)}${i.expireAfterSeconds !== undefined ? ` ttl=${i.expireAfterSeconds}` : ''}`);
  }
}

type Plan = { stage?: string; indexName?: string; inputStage?: Plan; inputStages?: Plan[] };

function planChain(plan: Plan): Plan[] {
  const next = plan.inputStage ?? plan.inputStages?.[0];
  return [plan, ...(next ? planChain(next) : [])];
}

async function explainIdentifiers(db: Db): Promise<void> {
  const explain = await db.collection('reports').find({ identifiers: 'phone:test' }).explain('executionStats');
  const winning = explain.queryPlanner.winningPlan;
  const chain = planChain(winning.queryPlan ?? winning);
  console.log('winning plan:', chain.map((p) => p.stage + (p.indexName ? `(${p.indexName})` : '')).join(' -> '));
  const ix = chain.find((p) => p.stage === 'IXSCAN');
  if (ix?.indexName !== 'identifiers_1') throw new Error('expected IXSCAN on identifiers_1');
  console.log('OK: IXSCAN on identifiers_1');
}

async function main(): Promise<void> {
  const dbName = getDbName();
  console.log(`database: ${dbName}`);
  const db = await getDb();
  await ensureCollections(db);
  await ensureIndexes(db);

  if (dbName === SHARED_DB) {
    await ensureSearchIndexes(db);
    await waitQueryable(db);
    await vectorSmokeTest(db);
  } else {
    console.log('skipped search indexes (sandbox)');
  }

  await printIndexes(db);
  await explainIdentifiers(db);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await (await getClient().catch(() => null))?.close();
  });
