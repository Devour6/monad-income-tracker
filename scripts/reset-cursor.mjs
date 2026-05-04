import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const target = process.argv[2];
if (!target) { console.error('usage: reset-cursor.mjs <block>'); process.exit(1); }
const r = await sql`UPDATE claim_indexer_state SET last_block = ${BigInt(target)}, updated_at = now() WHERE id = 1 RETURNING *`;
console.log('cursor:', r[0]);
