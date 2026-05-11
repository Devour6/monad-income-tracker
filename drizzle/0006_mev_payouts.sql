-- shMonad SendValidatorRewards event indexer
--
-- Records every MEV/priority-fee payout from the shMonad proxy
-- (0x1b68626dca36c7fe922fd2d55e4f631d962de19c) to a validator's stake pool.
--
-- Event: SendValidatorRewards(address sender, uint64 valId, uint256 validatorPayout, uint256 feeTaken)
-- topic0 = 0xa00ba9b9fddae2429c7131955af6dd8add3137d90ca8d1145d773f79cb484dd2
--
-- validatorPayout = MON sent to the staking precompile's externalReward (becomes
--   delegator-claimable income, eventually surfaces in ClaimRewards events).
-- feeTaken = shMonad's protocol-revenue slice (stays in shMonad as boost commission).

CREATE TABLE IF NOT EXISTS "mev_payouts" (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS "mev_payouts_tx_log_idx"
  ON "mev_payouts" ("tx_hash", "log_index");

CREATE INDEX IF NOT EXISTS "mev_payouts_validator_idx"
  ON "mev_payouts" ("validator_id", "block_number");

CREATE INDEX IF NOT EXISTS "mev_payouts_block_idx"
  ON "mev_payouts" ("block_number");

CREATE TABLE IF NOT EXISTS "mev_indexer_state" (
  "id" integer PRIMARY KEY,
  "last_block" bigint NOT NULL,
  "updated_at" timestamptz DEFAULT now()
);
