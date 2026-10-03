import { config } from 'dotenv';
config({ path: '.env.local' });

import { getClient, getDb } from '../lib/db';

async function main() {
  const db = await getDb();
  await db.command({ ping: 1 });
  const info = await db.admin().serverInfo();
  console.log('pinged', `MongoDB ${info.version}`);
  await (await getClient()).close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
