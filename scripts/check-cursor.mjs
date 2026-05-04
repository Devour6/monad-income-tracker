import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const r = await sql`SELECT * FROM claim_indexer_state WHERE id=1`;
console.log('cursor:', r[0]);
const c = await sql`SELECT COUNT(*)::int AS n,
  COALESCE(MIN(block_number),0)::text AS min_b,
  COALESCE(MAX(block_number),0)::text AS max_b
  FROM claim_events`;
console.log('claim_events:', c[0]);
// Phase auth = 0x621f21cb816df5f8f7026938f346dc1c91358ea2
const p = await sql`SELECT COUNT(*)::int AS n,
  COALESCE(SUM(amount_wei::numeric)/1e18,0)::text AS total_mon
  FROM claim_events
  WHERE validator_id=200
    AND delegator='0x621f21cb816df5f8f7026938f346dc1c91358ea2'`;
console.log('Phase claims so far:', p[0]);
