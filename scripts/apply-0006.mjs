import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

const stmts = [
  `CREATE TABLE IF NOT EXISTS "mev_payouts" (
    "id" serial PRIMARY KEY,
    "validator_id" integer NOT NULL,
    "coinbase" text NOT NULL,
    "validator_payout_wei" numeric(78,0) NOT NULL,
    "fee_taken_wei" numeric(78,0) NOT NULL,
    "block_number" bigint NOT NULL,
    "block_timestamp" timestamptz NOT NULL,
    "tx_hash" text NOT NULL,
    "log_index" integer NOT NULL,
    "indexed_at" timestamptz DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "mev_payouts_tx_log_idx" ON "mev_payouts" ("tx_hash", "log_index")`,
  `CREATE INDEX IF NOT EXISTS "mev_payouts_validator_idx" ON "mev_payouts" ("validator_id", "block_number")`,
  `CREATE INDEX IF NOT EXISTS "mev_payouts_block_idx" ON "mev_payouts" ("block_number")`,
  `CREATE TABLE IF NOT EXISTS "mev_indexer_state" (
    "id" integer PRIMARY KEY,
    "last_block" bigint NOT NULL,
    "updated_at" timestamptz DEFAULT now()
  )`,
];

for (const stmt of stmts) {
  try {
    await sql(stmt);
    console.log('OK:', stmt.split('\n')[0].slice(0, 80));
  } catch (e) {
    console.log('ERR:', e.message);
  }
}

const [t1] = await sql`SELECT to_regclass('mev_payouts') as t`;
const [t2] = await sql`SELECT to_regclass('mev_indexer_state') as t`;
console.log('tables:', t1.t, t2.t);
