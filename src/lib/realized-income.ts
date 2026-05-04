import { db } from "@/lib/db";
import { epochSnapshots } from "@/lib/db/schema";
import { eq, asc, inArray } from "drizzle-orm";

/**
 * Realized commission income — accumulator-based.
 *
 * The Monad staking precompile's `unclaimed_rewards` field tracks the FULL
 * pool reward (commission + delegator share), not commission only. Confirmed
 * empirically: per-epoch `unclaimed_rewards` delta exactly equals
 * (accRewardPerToken_delta * stake / 1e36), which is the pool reward formula.
 *
 * To get the validator's actual commission take, we apply the per-epoch
 * commission rate to the per-epoch pool reward:
 *
 *   pool_wei  = (accRewardPerToken_curr - accRewardPerToken_prev) * stake_prev / 1e36
 *   comm_wei  = pool_wei * commission_rate_curr / 1e18
 *   lifetime  = SUM(comm_wei across all epoch transitions)
 *
 * `commission` slot stores the rate as a uint256 with 1e18 precision
 * (e.g. 0.20e18 = 20%).
 *
 * Validated against Phase Stake CFO records (~82,899 MON ground truth).
 */

const WEI = BigInt(10) ** BigInt(18);
const ACCUMULATOR_DENOMINATOR = BigInt(10) ** BigInt(36);

export interface RealizedIncome {
  validatorId: number;
  firstEpoch: number | null;
  lastEpoch: number | null;
  snapshotCount: number;
  /** Lifetime commission earned (sum of per-epoch commission accruals). */
  totalCommissionMon: number;
  /** Currently sitting unclaimed in the precompile. NOTE: this field on-chain
   *  represents the full pool's accrual, not commission-only. We surface it
   *  for transparency but it is NOT used in totalCommissionMon. */
  currentUnclaimedMon: number;
  /** Sum of detected drops in unclaimed_rewards (full pool, not commission). */
  totalClaimedMon: number;
  /** Number of times unclaimed_rewards dropped (claim or distribution event). */
  claimCount: number;
  /** Total reward pool flowed through this validator's stake (commission + delegator). */
  totalPoolMon: number;
}

interface SnapshotRow {
  epoch: number;
  accRewardPerToken: bigint;
  stakeWei: bigint;
  commission: bigint;
  unclaimedRewards: bigint;
}

function weiToMon(wei: bigint): number {
  return Number(wei / WEI) + Number(wei % WEI) / Number(WEI);
}

/**
 * Walk consecutive snapshots, computing per-epoch commission as
 * pool_reward × commission_rate. Sum across all transitions.
 */
function reduceSnapshots(rows: SnapshotRow[]): {
  totalCommissionWei: bigint;
  totalPoolWei: bigint;
  currentUnclaimedWei: bigint;
  totalClaimedWei: bigint;
  claimCount: number;
} {
  let totalCommissionWei = BigInt(0);
  let totalPoolWei = BigInt(0);
  let totalClaimedWei = BigInt(0);
  let claimCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const curr = rows[i];

    // Pool reward this epoch = accumulator delta × stake / 1e36
    const accDelta = curr.accRewardPerToken - prev.accRewardPerToken;
    if (accDelta > BigInt(0) && prev.stakeWei > BigInt(0)) {
      const poolWei = (accDelta * prev.stakeWei) / ACCUMULATOR_DENOMINATOR;
      totalPoolWei += poolWei;

      // Commission rate is stored with 1e18 precision (0.20e18 = 20%)
      const commWei = (poolWei * curr.commission) / WEI;
      totalCommissionWei += commWei;
    }

    // Track unclaimed drops separately for diagnostic surfaces
    if (curr.unclaimedRewards < prev.unclaimedRewards) {
      totalClaimedWei += prev.unclaimedRewards - curr.unclaimedRewards;
      claimCount += 1;
    }
  }

  const currentUnclaimedWei =
    rows.length > 0 ? rows[rows.length - 1].unclaimedRewards : BigInt(0);

  return {
    totalCommissionWei,
    totalPoolWei,
    currentUnclaimedWei,
    totalClaimedWei,
    claimCount,
  };
}

function rowsToSnaps(
  raw: Array<{
    epoch: number;
    accRewardPerToken: string;
    stakeWei: string;
    commission: string;
    unclaimedRewards: string;
  }>
): SnapshotRow[] {
  return raw.map((s) => ({
    epoch: s.epoch,
    accRewardPerToken: BigInt(s.accRewardPerToken),
    stakeWei: BigInt(s.stakeWei),
    commission: BigInt(s.commission),
    unclaimedRewards: BigInt(s.unclaimedRewards),
  }));
}

function emptyResult(validatorId: number): RealizedIncome {
  return {
    validatorId,
    firstEpoch: null,
    lastEpoch: null,
    snapshotCount: 0,
    totalCommissionMon: 0,
    currentUnclaimedMon: 0,
    totalClaimedMon: 0,
    claimCount: 0,
    totalPoolMon: 0,
  };
}

/** Realized commission income for a single validator's full lifetime. */
export async function getRealizedIncome(
  validatorId: number
): Promise<RealizedIncome> {
  const raw = await db
    .select({
      epoch: epochSnapshots.epoch,
      accRewardPerToken: epochSnapshots.accRewardPerToken,
      stakeWei: epochSnapshots.stakeWei,
      commission: epochSnapshots.commission,
      unclaimedRewards: epochSnapshots.unclaimedRewards,
    })
    .from(epochSnapshots)
    .where(eq(epochSnapshots.validatorId, validatorId))
    .orderBy(asc(epochSnapshots.epoch));

  if (raw.length === 0) return emptyResult(validatorId);

  const rows = rowsToSnaps(raw);
  const r = reduceSnapshots(rows);

  return {
    validatorId,
    firstEpoch: rows[0].epoch,
    lastEpoch: rows[rows.length - 1].epoch,
    snapshotCount: rows.length,
    totalCommissionMon: weiToMon(r.totalCommissionWei),
    totalPoolMon: weiToMon(r.totalPoolWei),
    currentUnclaimedMon: weiToMon(r.currentUnclaimedWei),
    totalClaimedMon: weiToMon(r.totalClaimedWei),
    claimCount: r.claimCount,
  };
}

/** Batched lookup — used by leaderboard and compare endpoints. */
export async function getRealizedIncomeBatch(
  validatorIds: number[]
): Promise<Map<number, RealizedIncome>> {
  const out = new Map<number, RealizedIncome>();
  if (validatorIds.length === 0) return out;

  const raw = await db
    .select({
      validatorId: epochSnapshots.validatorId,
      epoch: epochSnapshots.epoch,
      accRewardPerToken: epochSnapshots.accRewardPerToken,
      stakeWei: epochSnapshots.stakeWei,
      commission: epochSnapshots.commission,
      unclaimedRewards: epochSnapshots.unclaimedRewards,
    })
    .from(epochSnapshots)
    .where(inArray(epochSnapshots.validatorId, validatorIds))
    .orderBy(asc(epochSnapshots.epoch));

  const byValidator = new Map<number, SnapshotRow[]>();
  for (const s of raw) {
    let arr = byValidator.get(s.validatorId);
    if (!arr) {
      arr = [];
      byValidator.set(s.validatorId, arr);
    }
    arr.push({
      epoch: s.epoch,
      accRewardPerToken: BigInt(s.accRewardPerToken),
      stakeWei: BigInt(s.stakeWei),
      commission: BigInt(s.commission),
      unclaimedRewards: BigInt(s.unclaimedRewards),
    });
  }

  for (const id of validatorIds) {
    const rows = byValidator.get(id) ?? [];
    if (rows.length === 0) {
      out.set(id, emptyResult(id));
      continue;
    }
    const r = reduceSnapshots(rows);
    out.set(id, {
      validatorId: id,
      firstEpoch: rows[0].epoch,
      lastEpoch: rows[rows.length - 1].epoch,
      snapshotCount: rows.length,
      totalCommissionMon: weiToMon(r.totalCommissionWei),
      totalPoolMon: weiToMon(r.totalPoolWei),
      currentUnclaimedMon: weiToMon(r.currentUnclaimedWei),
      totalClaimedMon: weiToMon(r.totalClaimedWei),
      claimCount: r.claimCount,
    });
  }

  return out;
}
