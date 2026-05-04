import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
// Top delegators across ALL validators
const r = await sql`SELECT delegator, COUNT(*)::int AS n,
  ROUND((SUM(amount_wei::numeric)/1e18)::numeric, 2)::text AS total_mon
  FROM claim_events
  GROUP BY delegator
  ORDER BY n DESC
  LIMIT 5`;
console.log('Top 5 claimers across all validators:');
for (const row of r) console.log(' ', row);

// Sample 3 claim events with full detail
const s = await sql`SELECT validator_id, delegator, amount_wei, epoch, block_number, tx_hash
  FROM claim_events ORDER BY block_number DESC LIMIT 5`;
console.log('\nMost recent 5 events:');
for (const row of s) console.log(' ', row);
