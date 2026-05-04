import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
// Top delegators by claim count
const r = await sql`SELECT delegator, COUNT(*)::int AS n,
  ROUND((SUM(amount_wei::numeric)/1e18)::numeric, 2)::text AS total_mon
  FROM claim_events
  WHERE validator_id=200
  GROUP BY delegator
  ORDER BY n DESC
  LIMIT 10`;
console.log('Phase #200 delegators with claims:');
for (const row of r) console.log(' ', row);

// What's Phase's auth address?
const a = await sql`SELECT auth_address FROM validators WHERE validator_id=200`;
console.log('Phase auth:', a[0]?.auth_address);
