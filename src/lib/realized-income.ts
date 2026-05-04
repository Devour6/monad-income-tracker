import { db } from "@/lib/db";
import { claimEvents } from "@/lib/db/claim-events-schema";
import { epochSnapshots, validators } from "@/lib/db/schema";
import { sql, eq, inArray, asc, desc, and, gte, lte } from "drizzle-orm";

/**
 * Realized income — REAL on-chain income tracking, no modeling.
 *
 * Key insight (verified empirically):
 *   `unclaimedRewards` on getValidator() is the WHOLE pool's pending balance,
 *   not just the validator's commission. Backpack runs 0% commission yet has
 *   6+M MON in unclaimedRewards — that's delegator share, not commission.
 *
 *   So "lifetime income to the validator" cannot be `claimed + unclaimed`
 *   wholesale. The validator only owns:
 *     - everything they've already CLAIMED (sum of ClaimRewards events
 *       where delegator = auth_address) — fully on-chain, exact
 *     - their PRO-RATA share of what's still pending in the pool, which
 *       equals `unclaimed × (auth_self_stake / total_stake)`. The rest of
 *       the pool belongs to other delegators.
 *
 * If a validator has commission > 0% there's an additional commission slice
 * baked into pool growth that the auth address picks up when claiming.
 * That's already inside the claimed amount — claims include both
 * self-stake yield AND commission. We don't need to decompose them; the
 * sum is what hit the validator's wallet.
 *
 * Public API
 * ----------
 * - getRealizedIncome(validatorId)  — single validator
 * - getRealizedIncomeBatch(ids)     — batched for leaderboard/compare
 * - getClaimEvents(validatorId)     — per-claim history for the dashboard
 */

const WEI = BigInt(10) ** BigInt(18);

export interface RealizedIncome {
  validatorId: number;
  /** Earliest claim block (null if no claims yet). */
  firstClaimBlock: bigint | null;
  /** Latest claim block. */
  lastClaimBlock: bigint | null;
  /** Number of ClaimRewards events the auth address has issued. */
  claimCount: number;
  /** Sum of all auth-address claim amounts ever paid out, in MON. */
  totalClaimedMon: number;
  /**
   * Validator's pro-rata share of currently pending pool rewards
   * (unclaimed × auth_self_stake / total_stake). This is approximately
   * what the validator would receive if they called claimRewards now.
   */
  pendingShareMon: number;
  /** Total unclaimed pool — informational, NOT counted as validator income. */
  poolUnclaimedMon: number;
  /**
   * Lifetime commission = totalClaimed + pendingShare.
   * What the validator has actually earned, minus pure delegator-pool MON
   * that doesn't belong to them.
   */
  totalCommissionMon: number;
  /** Backward-compat aliases (do not use for new code). */
  currentUnclaimedMon: number; // = pendingShareMon
  firstEpoch: number | null;
  lastEpoch: number | null;
  snapshotCount: number;
  totalPoolMon: number;
}

function weiToMon(wei: bigint): number {
  return Number(wei / WEI) + Number(wei % WEI) / Number(WEI);
}

interface SnapMeta {
  unclaimedWei: bigint;
  stakeWei: bigint;
  selfStakeWei: bigint;
  firstEpoch: number | null;
  lastEpoch: number | null;
  snapshotCount: number;
}

/**
 * Latest snapshot + epoch bounds for one validator. We need stake +
 * self_stake to compute the pro-rata share of the pending pool.
 */
async function getValidatorSnapshotMeta(
  validatorId: number
): Promise<SnapMeta> {
  const aggRows = (await db
    .select({
      cnt: sql<number>`COUNT(*)::int`,
      minE: sql<number | null>`MIN(${epochSnapshots.epoch})`,
      maxE: sql<number | null>`MAX(${epochSnapshots.epoch})`,
    })
    .from(epochSnapshots)
    .where(eq(epochSnapshots.validatorId, validatorId))) as unknown as {
    cnt: number;
    minE: number | null;
    maxE: number | null;
  }[];
  const agg = aggRows[0];
  if (!agg || !agg.cnt) {
    return {
      unclaimedWei: BigInt(0),
      stakeWei: BigInt(0),
      selfStakeWei: BigInt(0),
      firstEpoch: null,
      lastEpoch: null,
      snapshotCount: 0,
    };
  }
  const latest = await db
    .select({
      unclaimed: epochSnapshots.unclaimedRewards,
      stake: epochSnapshots.stakeWei,
      self: epochSnapshots.selfStakeWei,
    })
    .from(epochSnapshots)
    .where(eq(epochSnapshots.validatorId, validatorId))
    .orderBy(desc(epochSnapshots.epoch))
    .limit(1);
  const row = latest[0];
  return {
    unclaimedWei: row ? BigInt(row.unclaimed) : BigInt(0),
    stakeWei: row ? BigInt(row.stake) : BigInt(0),
    selfStakeWei: row?.self ? BigInt(row.self) : BigInt(0),
    firstEpoch: agg.minE,
    lastEpoch: agg.maxE,
    snapshotCount: Number(agg.cnt),
  };
}

/**
 * Compute the validator's pro-rata share of the pending pool. If self-stake
 * data is missing we fall back to 0 (better to under-report than to
 * overstate income).
 */
function computePendingShareMon(meta: SnapMeta): number {
  if (meta.stakeWei === BigInt(0) || meta.selfStakeWei === BigInt(0)) return 0;
  // share_wei = unclaimed_wei * self / stake
  const shareWei = (meta.unclaimedWei * meta.selfStakeWei) / meta.stakeWei;
  return weiToMon(shareWei);
}

/** Realized commission income for a single validator. */
export async function getRealizedIncome(
  validatorId: number
): Promise<RealizedIncome> {
  const [meta] = await db
    .select({ authAddress: validators.authAddress })
    .from(validators)
    .where(eq(validators.validatorId, validatorId))
    .limit(1);

  if (!meta) {
    return {
      validatorId,
      firstClaimBlock: null,
      lastClaimBlock: null,
      claimCount: 0,
      totalClaimedMon: 0,
      pendingShareMon: 0,
      poolUnclaimedMon: 0,
      totalCommissionMon: 0,
      currentUnclaimedMon: 0,
      firstEpoch: null,
      lastEpoch: null,
      snapshotCount: 0,
      totalPoolMon: 0,
    };
  }

  const auth = meta.authAddress.toLowerCase();
  const aggRows = (await db
    .select({
      total: sql<string>`COALESCE(SUM(${claimEvents.amountWei}), 0)::text`,
      cnt: sql<number>`COUNT(*)::int`,
      firstBlk: sql<string>`COALESCE(MIN(${claimEvents.blockNumber}), 0)::text`,
      lastBlk: sql<string>`COALESCE(MAX(${claimEvents.blockNumber}), 0)::text`,
    })
    .from(claimEvents)
    .where(
      and(
        eq(claimEvents.validatorId, validatorId),
        eq(claimEvents.delegator, auth)
      )
    )) as unknown as {
    total: string;
    cnt: number;
    firstBlk: string;
    lastBlk: string;
  }[];

  const agg = aggRows[0];
  const totalClaimedWei = BigInt(agg?.total || "0");
  const claimCount = Number(agg?.cnt || 0);
  const firstBlk = BigInt(agg?.firstBlk || "0");
  const lastBlk = BigInt(agg?.lastBlk || "0");

  const snapMeta = await getValidatorSnapshotMeta(validatorId);

  const totalClaimedMon = weiToMon(totalClaimedWei);
  const pendingShareMon = computePendingShareMon(snapMeta);
  const poolUnclaimedMon = weiToMon(snapMeta.unclaimedWei);
  const totalCommissionMon = totalClaimedMon + pendingShareMon;

  return {
    validatorId,
    firstClaimBlock: firstBlk > BigInt(0) ? firstBlk : null,
    lastClaimBlock: lastBlk > BigInt(0) ? lastBlk : null,
    claimCount,
    totalClaimedMon,
    pendingShareMon,
    poolUnclaimedMon,
    totalCommissionMon,
    currentUnclaimedMon: pendingShareMon,
    firstEpoch: snapMeta.firstEpoch,
    lastEpoch: snapMeta.lastEpoch,
    snapshotCount: snapMeta.snapshotCount,
    totalPoolMon: 0,
  };
}

/** Batched lookup for leaderboard/compare endpoints. */
export async function getRealizedIncomeBatch(
  validatorIds: number[]
): Promise<Map<number, RealizedIncome>> {
  const out = new Map<number, RealizedIncome>();
  if (validatorIds.length === 0) return out;

  // Build a safely parameterized IN list. Drizzle's `sql.join` interpolates
  // each value as a parameter — works portably without ANY/ALL casts.
  const idList = sql.join(
    validatorIds.map((id) => sql`${id}`),
    sql`, `
  );

  // 1. Auth addresses (lowercased for join match).
  const valRows = await db
    .select({
      validatorId: validators.validatorId,
      authAddress: validators.authAddress,
    })
    .from(validators)
    .where(inArray(validators.validatorId, validatorIds));
  const authByVid = new Map<number, string>();
  for (const v of valRows) {
    authByVid.set(v.validatorId, v.authAddress.toLowerCase());
  }

  // 2. Claim aggregates per validator (auth-address claims only).
  type ClaimRow = {
    validator_id: number;
    total_wei: string;
    cnt: number;
    first_blk: string;
    last_blk: string;
  };
  const claimResult = await db.execute(sql`
    SELECT ce.validator_id,
      COALESCE(SUM(ce.amount_wei), 0)::text AS total_wei,
      COUNT(*)::int AS cnt,
      COALESCE(MIN(ce.block_number), 0)::text AS first_blk,
      COALESCE(MAX(ce.block_number), 0)::text AS last_blk
    FROM claim_events ce
    INNER JOIN validators v ON v.validator_id = ce.validator_id
      AND LOWER(v.auth_address) = ce.delegator
    WHERE ce.validator_id IN (${idList})
    GROUP BY ce.validator_id
  `);
  const claimRows = (
    Array.isArray(claimResult)
      ? claimResult
      : ((claimResult as { rows: unknown[] }).rows ?? [])
  ) as ClaimRow[];
  const claimAgg = new Map<
    number,
    { totalWei: bigint; cnt: number; first: bigint; last: bigint }
  >();
  for (const r of claimRows) {
    claimAgg.set(Number(r.validator_id), {
      totalWei: BigInt(r.total_wei),
      cnt: Number(r.cnt),
      first: BigInt(r.first_blk),
      last: BigInt(r.last_blk),
    });
  }

  // 3. Latest snapshot per validator (unclaimed + stake + self-stake) +
  //    epoch bounds.
  type LatestRow = {
    validator_id: number;
    unclaimed_rewards: string;
    stake_wei: string;
    self_stake_wei: string | null;
    epoch: number;
  };
  const latestResult = await db.execute(sql`
    SELECT validator_id, unclaimed_rewards, stake_wei, self_stake_wei, epoch
    FROM (
      SELECT validator_id, unclaimed_rewards, stake_wei, self_stake_wei, epoch,
        ROW_NUMBER() OVER (PARTITION BY validator_id ORDER BY epoch DESC) AS rn
      FROM epoch_snapshots
      WHERE validator_id IN (${idList})
    ) t
    WHERE rn = 1
  `);
  const latestRows = (
    Array.isArray(latestResult)
      ? latestResult
      : ((latestResult as { rows: unknown[] }).rows ?? [])
  ) as LatestRow[];
  const latestMap = new Map<
    number,
    { unclaimedWei: bigint; stakeWei: bigint; selfStakeWei: bigint }
  >();
  for (const r of latestRows) {
    latestMap.set(Number(r.validator_id), {
      unclaimedWei: BigInt(r.unclaimed_rewards),
      stakeWei: BigInt(r.stake_wei),
      selfStakeWei: r.self_stake_wei ? BigInt(r.self_stake_wei) : BigInt(0),
    });
  }

  type SnapAggRow = {
    validator_id: number;
    cnt: number;
    min_e: number;
    max_e: number;
  };
  const snapAggResult = await db.execute(sql`
    SELECT validator_id,
      COUNT(*)::int AS cnt,
      MIN(epoch)::int AS min_e,
      MAX(epoch)::int AS max_e
    FROM epoch_snapshots
    WHERE validator_id IN (${idList})
    GROUP BY validator_id
  `);
  const snapAggRows = (
    Array.isArray(snapAggResult)
      ? snapAggResult
      : ((snapAggResult as { rows: unknown[] }).rows ?? [])
  ) as SnapAggRow[];
  const snapMetaMap = new Map<
    number,
    { cnt: number; minE: number; maxE: number }
  >();
  for (const r of snapAggRows) {
    snapMetaMap.set(Number(r.validator_id), {
      cnt: Number(r.cnt),
      minE: Number(r.min_e),
      maxE: Number(r.max_e),
    });
  }

  // 4. Assemble.
  for (const id of validatorIds) {
    const cAgg = claimAgg.get(id);
    const latest = latestMap.get(id);
    const sm = snapMetaMap.get(id);
    const totalClaimedWei = cAgg?.totalWei ?? BigInt(0);
    const totalClaimedMon = weiToMon(totalClaimedWei);

    let pendingShareMon = 0;
    let poolUnclaimedMon = 0;
    if (latest) {
      poolUnclaimedMon = weiToMon(latest.unclaimedWei);
      if (latest.stakeWei > BigInt(0) && latest.selfStakeWei > BigInt(0)) {
        const shareWei =
          (latest.unclaimedWei * latest.selfStakeWei) / latest.stakeWei;
        pendingShareMon = weiToMon(shareWei);
      }
    }

    out.set(id, {
      validatorId: id,
      firstClaimBlock: cAgg && cAgg.first > BigInt(0) ? cAgg.first : null,
      lastClaimBlock: cAgg && cAgg.last > BigInt(0) ? cAgg.last : null,
      claimCount: cAgg?.cnt ?? 0,
      totalClaimedMon,
      pendingShareMon,
      poolUnclaimedMon,
      totalCommissionMon: totalClaimedMon + pendingShareMon,
      currentUnclaimedMon: pendingShareMon,
      firstEpoch: sm?.minE ?? null,
      lastEpoch: sm?.maxE ?? null,
      snapshotCount: sm?.cnt ?? 0,
      totalPoolMon: 0,
    });
  }

  return out;
}

/**
 * Per-claim-event detail for a validator — used by the dashboard to render
 * the claim history table. Returns most recent first.
 */
export interface ClaimEventDetail {
  blockNumber: bigint;
  timestamp: Date;
  amountMon: number;
  txHash: string;
  epoch: number;
}

export async function getClaimEvents(
  validatorId: number,
  opts?: { limit?: number; fromBlock?: bigint; toBlock?: bigint }
): Promise<ClaimEventDetail[]> {
  const [meta] = await db
    .select({ authAddress: validators.authAddress })
    .from(validators)
    .where(eq(validators.validatorId, validatorId))
    .limit(1);
  if (!meta) return [];

  const auth = meta.authAddress.toLowerCase();
  const conds = [
    eq(claimEvents.validatorId, validatorId),
    eq(claimEvents.delegator, auth),
  ];
  if (opts?.fromBlock != null) {
    conds.push(gte(claimEvents.blockNumber, opts.fromBlock));
  }
  if (opts?.toBlock != null) {
    conds.push(lte(claimEvents.blockNumber, opts.toBlock));
  }
  const limit = Math.min(Math.max(1, opts?.limit ?? 200), 1000);
  const rows = await db
    .select({
      blockNumber: claimEvents.blockNumber,
      blockTimestamp: claimEvents.blockTimestamp,
      amountWei: claimEvents.amountWei,
      txHash: claimEvents.txHash,
      epoch: claimEvents.epoch,
    })
    .from(claimEvents)
    .where(and(...conds))
    .orderBy(desc(claimEvents.blockNumber))
    .limit(limit);

  return rows.map((r) => ({
    blockNumber: r.blockNumber,
    timestamp: r.blockTimestamp,
    amountMon: weiToMon(BigInt(r.amountWei)),
    txHash: r.txHash,
    epoch: r.epoch,
  }));
}

export { asc };
