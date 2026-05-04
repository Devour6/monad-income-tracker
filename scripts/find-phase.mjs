import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
// Any claim event referencing validator 200, regardless of delegator
const all = await sql`SELECT delegator, COUNT(*)::int AS n,
  ROUND((SUM(amount_wei::numeric)/1e18)::numeric, 2)::text AS total_mon,
  COALESCE(MIN(block_number),0)::text AS min_b,
  COALESCE(MAX(block_number),0)::text AS max_b
  FROM claim_events
  WHERE validator_id=200
  GROUP BY delegator
  ORDER BY n DESC
  LIMIT 10`;
console.log('All Phase #200 claim events (any delegator):');
for (const row of all) console.log(' ', row);

// What's the total range covered for v200?
const range = await sql`SELECT 
  COALESCE(MIN(block_number),0)::text AS min_b,
  COALESCE(MAX(block_number),0)::text AS max_b,
  COUNT(*)::int AS n
  FROM claim_events WHERE validator_id=200`;
console.log('\nPhase #200 in claim_events:', range[0]);

// What's our overall block coverage?
const cov = await sql`SELECT
  COALESCE(MIN(block_number),0)::text AS min_b,
  COALESCE(MAX(block_number),0)::text AS max_b,
  COUNT(*)::int AS n
  FROM claim_events`;
console.log('\nTotal claim_events range:', cov[0]);
