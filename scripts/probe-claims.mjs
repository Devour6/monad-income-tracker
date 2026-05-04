import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const r = await sql`SELECT MIN(epoch) as min_e, MAX(epoch) as max_e, COUNT(*) as n FROM epoch_snapshots`;
console.log('snap range:', r[0]);
const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'epoch_priority_fees'`;
console.log('priority fee cols:', cols.map(c => c.column_name).join(', '));
