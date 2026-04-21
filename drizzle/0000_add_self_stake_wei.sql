-- Add self-stake tracking column for validator income attribution.
-- Nullable because historical rows predating self-stake tracking won't have it.
ALTER TABLE "epoch_snapshots" ADD COLUMN IF NOT EXISTS "self_stake_wei" text;
