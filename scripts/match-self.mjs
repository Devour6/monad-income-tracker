import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
// Join claim_events with validators on (validator_id, delegator==auth_address)
const r = await sql`
  SELECT ce.validator_id, COUNT(*)::int AS n,
    ROUND((SUM(ce.amount_wei::numeric)/1e18)::numeric, 2)::text AS total_mon
  FROM claim_events ce
  INNER JOIN validators v
    ON v.validator_id = ce.validator_id
    AND LOWER(v.auth_address) = ce.delegator
  GROUP BY ce.validator_id
  ORDER BY n DESC
  LIMIT 10`;
console.log('Validators where someone claimed using auth_address as delegator:');
for (const row of r) console.log(' ', row);

const tot = await sql`
  SELECT COUNT(*)::int AS commission_claims,
    (SELECT COUNT(*)::int FROM claim_events) AS total_claims
  FROM claim_events ce
  INNER JOIN validators v
    ON v.validator_id = ce.validator_id
    AND LOWER(v.auth_address) = ce.delegator`;
console.log('\nTotals:', tot[0]);
