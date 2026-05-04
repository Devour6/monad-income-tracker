import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';
const sql = neon(process.env.DATABASE_URL);
const text = fs.readFileSync('drizzle/0005_claim_events.sql', 'utf8');
// Strip comments first, then split
const cleaned = text.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const stmts = cleaned.split(';').map(s => s.trim()).filter(s => s.length > 5);
for (const s of stmts) {
  try {
    await sql(s);
    console.log('OK:', s.split('\n')[0].slice(0, 80));
  } catch (e) {
    console.log('ERR:', e.message);
  }
}
const r = await sql`SELECT to_regclass('claim_events') as t1, to_regclass('claim_indexer_state') as t2`;
console.log('tables exist:', r[0]);
