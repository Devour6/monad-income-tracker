import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  SELECT epoch FROM epoch_snapshots
  WHERE validator_id = 200 AND epoch BETWEEN 1440 AND 1493
  ORDER BY epoch
`;
const have = new Set(rows.map(r => r.epoch));
const missing = [];
for (let e = 1440; e <= 1493; e++) {
  if (!have.has(e)) missing.push(e);
}
console.log('have epochs:', rows.length, 'missing:', missing.length);
console.log('missing:', missing.join(','));
