// Owner: B
// Loads RTB average monthly rents (CSO table RIQ02, latest quarter) into rent_baseline.
// Falls back to seed/rents-fallback.json when the CSO API is unreachable.
// Usage: npx tsx scripts/load-rents.ts [--shared]
import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { getClient, getDb } from '../lib/db';
import type { RentBaseline } from '../lib/types';

const SHARED_DB = 'scamring';
const SHARED_FLAG = '--shared';
const COLLECTION = 'rent_baseline';
const TABLE = 'RIQ02';
const API = 'https://ws.cso.ie/public/api.jsonrpc';
const METADATA_URL = `https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadMetadata/${TABLE}/JSON-stat/2.0/en`;
const QUARTER_DIMENSION = 'TLIST(Q1)';
const FALLBACK_FILE = 'seed/rents-fallback.json';
const ALL_BEDROOMS = 'All bedrooms';
const ALL_TYPES = 'All property types';

type CsoRow = {
  Quarter: string;
  'Number of Bedrooms': string;
  'Property Type': string;
  Location: string;
  VALUE: string;
};

type Metadata = {
  dimension: Record<string, { category: { index: string[] } }>;
};

function refuseSharedWithoutFlag(): void {
  const database = process.env.DB_NAME || SHARED_DB;
  if (database === SHARED_DB && !process.argv.includes(SHARED_FLAG)) {
    console.error(`Refusing to wipe ${COLLECTION} in the shared database "${SHARED_DB}". Re-run with ${SHARED_FLAG}.`);
    process.exit(1);
  }
}

async function latestQuarterCode(): Promise<string> {
  const response = await fetch(METADATA_URL);
  if (!response.ok) throw new Error(`CSO metadata HTTP ${response.status}`);
  const metadata = (await response.json()) as Metadata;
  const quarters = metadata.dimension[QUARTER_DIMENSION].category.index;
  return quarters[quarters.length - 1];
}

async function fetchQuarter(quarterCode: string): Promise<RentBaseline[]> {
  const query = {
    jsonrpc: '2.0',
    method: 'PxStat.Data.Cube_API.ReadDataset',
    params: {
      class: 'query',
      id: [QUARTER_DIMENSION],
      dimension: { [QUARTER_DIMENSION]: { category: { index: [quarterCode] } } },
      extension: {
        pivot: null,
        codes: false,
        language: { code: 'en' },
        format: { type: 'CSV', version: '1.0' },
        matrix: TABLE,
      },
      version: '2.0',
    },
  };
  const response = await fetch(`${API}?data=${encodeURIComponent(JSON.stringify(query))}`);
  if (!response.ok) throw new Error(`CSO dataset HTTP ${response.status}`);
  const body = (await response.json()) as { result?: string; error?: unknown };
  if (!body.result) throw new Error(`CSO dataset error: ${JSON.stringify(body.error)}`);
  const rows = parse(body.result, { columns: true, bom: true, skip_empty_lines: true }) as CsoRow[];
  return rows
    .filter((row) => row.VALUE !== '')
    .map((row) => ({
      location: row.Location.replace(/\s+,/g, ','),
      bedrooms: row['Number of Bedrooms'],
      propertyType: row['Property Type'],
      quarter: row.Quarter,
      avgRent: Number(row.VALUE),
    }));
}

async function loadRents(): Promise<{ rows: RentBaseline[]; source: string }> {
  try {
    const quarterCode = await latestQuarterCode();
    const rows = await fetchQuarter(quarterCode);
    if (rows.length === 0) throw new Error('CSO returned no rows');
    return { rows, source: `CSO ${TABLE} (live)` };
  } catch (error) {
    console.warn(`CSO download failed (${(error as Error).message}); using ${FALLBACK_FILE}`);
    const rows = JSON.parse(await readFile(FALLBACK_FILE, 'utf8')) as RentBaseline[];
    return { rows, source: FALLBACK_FILE };
  }
}

function printAreaMap(rows: RentBaseline[]): void {
  const overall = rows.filter((row) => row.bedrooms === ALL_BEDROOMS && row.propertyType === ALL_TYPES);
  const districts = new Map<string, number[]>();
  for (const row of overall) {
    const district = row.location.match(/Dublin \d+W?$/)?.[0];
    if (!district) continue;
    districts.set(district, [...(districts.get(district) ?? []), row.avgRent]);
  }
  const sorted = [...districts].sort(
    ([left], [right]) =>
      Number(left.replace(/\D/g, '')) - Number(right.replace(/\D/g, '')) || left.localeCompare(right),
  );
  console.table(
    sorted.map(([district, rents]) => ({
      district,
      areas: rents.length,
      averageEur: Math.round(rents.reduce((sum, rent) => sum + rent, 0) / rents.length),
    })),
  );
  console.log(`${new Set(rows.map((row) => row.location)).size} locations, ${overall.length} with an all-bedrooms average`);
}

async function main(): Promise<void> {
  refuseSharedWithoutFlag();
  const { rows, source } = await loadRents();
  const database = await getDb();
  const collection = database.collection<RentBaseline>(COLLECTION);
  await collection.deleteMany({});
  await collection.insertMany(rows.map((row) => ({ ...row })));
  printAreaMap(rows);
  console.log(`Inserted ${rows.length} rows for ${rows[0].quarter} from ${source} into ${database.databaseName}.${COLLECTION}`);
  await (await getClient()).close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
