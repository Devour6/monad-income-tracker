import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
// Find gaps in coverage by bucketing block_number
const r = await sql`SELECT
  FLOOR(block_number / 100000)::bigint * 100000 AS bucket,
  COUNT(*)::int AS n
  FROM claim_events
  GROUP BY bucket
  ORDER BY bucket`;
console.log('Block coverage buckets (100k each), buckets with 0 events would be missing:');
let prev = null;
for (const row of r) {
  if (prev !== null && Number(row.bucket) - prev > 100000) {
    console.log(`  GAP: ${prev}..${row.bucket}`);
  }
  console.log(`  ${row.bucket}: ${row.n} events`);
  prev = Number(row.bucket);
}
