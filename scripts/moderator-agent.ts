// Owner: A (AI moderator)
// Runs the AI moderator once and prints the result. The app must be running (APP_BASE_URL,
// default http://localhost:3000): decisions go through POST /api/moderation/[id].
// Usage: npx tsx scripts/moderator-agent.ts [reportId] [--shared]
import { config } from 'dotenv';
config({ path: '.env.local' });

import { runModerator } from '../lib/agent/moderator';
import { getClient, getDbName } from '../lib/db';

const SHARED_DB = 'scamring';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (getDbName() === SHARED_DB && !args.includes('--shared')) {
    console.error(`Refusing to moderate the shared database "${SHARED_DB}". Use DB_NAME=scamring_<letter>, or pass --shared.`);
    process.exit(1);
  }
  const reportId = args.find((a) => !a.startsWith('--'));
  console.log(`database: ${getDbName()}  report: ${reportId ?? '(top of the pending queue)'}`);
  const result = await runModerator({ reportId });
  console.log('\nsteps:');
  for (const s of result.steps) console.log(`  ${s.at.slice(11, 19)}  ${s.kind.padEnd(8)} ${s.summary}`);
  const { steps: _steps, ...summary } = result;
  console.log('\nresult:', JSON.stringify({ ...summary, steps: result.steps.length }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await (await getClient().catch(() => null))?.close();
  });
