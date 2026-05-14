-- Per-validator auth-address pending claimable, sampled at each snapshot.
-- Comes from getDelegator(validatorId, authAddress).slot[2] — the precompile's
-- exact "what would claimRewards() pay out right now" value.
--
-- Replaces the derived empirical-share scalar in the income report:
--   validatorShareMon (epoch X) = Δ(auth_unclaimed_wei) + claims_by_auth_in_epoch_X
--   = strictly on-chain, no modeling.
ALTER TABLE epoch_snapshots
  ADD COLUMN IF NOT EXISTS auth_unclaimed_wei TEXT;

CREATE INDEX IF NOT EXISTS idx_epoch_snapshots_auth_unc
  ON epoch_snapshots (validator_id, epoch)
  WHERE auth_unclaimed_wei IS NOT NULL;
