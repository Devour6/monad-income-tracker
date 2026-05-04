import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const c = await sql`SELECT * FROM claim_indexer_state WHERE id=1`;
console.log('cursor:', c[0]);
const r = await sql`SELECT COUNT(*)::int AS n,
  COALESCE(MIN(block_number),0)::text AS min_b,
  COALESCE(MAX(block_number),0)::text AS max_b
  FROM claim_events`;
console.log('claim_events:', r[0]);
