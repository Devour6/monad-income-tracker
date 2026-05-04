-- Claim events — actual on-chain ClaimRewards logs from the staking precompile.
-- This is the source of truth for "income received": every row is a real
-- claim() transaction that moved MON from the precompile to a delegator
-- (validators are a special case where delegator == auth address).
--
-- Lifetime commission income for a validator V =
--   SUM(amount_wei) WHERE validator_id=V AND delegator=V.auth_address
--   + current unclaimed_rewards (still in precompile)
--
-- No projection. No accumulator math. No commission rate guessing.
-- Just the actual transactions.

CREATE TABLE IF NOT EXISTS "claim_events" (
  "id" SERIAL PRIMARY KEY,
  "validator_id" INTEGER NOT NULL,
  "delegator" TEXT NOT NULL,         -- lowercased 0x-address
  "amount_wei" NUMERIC(78, 0) NOT NULL,
  "epoch" INTEGER NOT NULL,
  "block_number" BIGINT NOT NULL,
  "block_timestamp" TIMESTAMP WITH TIME ZONE NOT NULL,
  "tx_hash" TEXT NOT NULL,
  "log_index" INTEGER NOT NULL,
  "indexed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Idempotency: same (tx, log_index) can never appear twice.
CREATE UNIQUE INDEX IF NOT EXISTS "claim_events_tx_log_idx"
  ON "claim_events" ("tx_hash", "log_index");

-- Hot paths.
CREATE INDEX IF NOT EXISTS "claim_events_validator_idx"
  ON "claim_events" ("validator_id", "block_number");
CREATE INDEX IF NOT EXISTS "claim_events_delegator_idx"
  ON "claim_events" ("delegator", "block_number");
CREATE INDEX IF NOT EXISTS "claim_events_block_idx"
  ON "claim_events" ("block_number");

-- Cursor for the claim event indexer (separate from the priority-fee indexer).
CREATE TABLE IF NOT EXISTS "claim_indexer_state" (
  "id" INTEGER PRIMARY KEY,           -- always 1
  "last_block" BIGINT NOT NULL,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
