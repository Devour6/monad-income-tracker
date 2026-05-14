import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const stmts = [
  `ALTER TABLE epoch_snapshots ADD COLUMN IF NOT EXISTS auth_unclaimed_wei TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_epoch_snapshots_auth_unc
     ON epoch_snapshots (validator_id, epoch)
     WHERE auth_unclaimed_wei IS NOT NULL`,
];

for (const stmt of stmts) {
  try {
    await sql(stmt);
    console.log("OK:", stmt.split("\n")[0].slice(0, 80));
  } catch (e) {
    console.log("ERR:", e.message);
  }
}

const cols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'epoch_snapshots' AND column_name = 'auth_unclaimed_wei'
`;
console.log("auth_unclaimed_wei present:", cols.length === 1);
