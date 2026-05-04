import { db } from "@/lib/db";
import { claimEvents } from "@/lib/db/claim-events-schema";
import { epochSnapshots, validators } from "@/lib/db/schema";
import { sql, eq, inArray, asc, desc, and, gte, lte } from "drizzle-orm";

/**
 * Realized income — REAL on-chain income tracking, not modeling.
 *
 * Source of truth = `claim_events` table, populated by the claim-event
 * indexer in src/lib/claim-event-indexer.ts. Each row is a literal
 * `ClaimRewards(validatorId, delegator, amount, epoch)` event emitted by
 * the staking precompile when a validator (or delegator) calls
 * `claimRewards()`.
 *
 * For VALIDATOR commission income: filter rows where `delegator` ==
 * the validator's auth address. The sum of those `amount` values is the
 * exact MON the validator has paid themselves. Plus their currently
 * unclaimed balance (from getValidator slot 5) = lifetime commission
 * collected + claimable.
 *
 * NO accumulator math. NO commission rate × pool projection. NO timing
 * approximations. Just a query of every claim transaction the validator
 * has signed and submitted on-chain.
 *
 * Public API consumers
 * --------------------
 * - getRealizedIncome(validatorId) — single validator
 * - getRealizedIncomeBatch(ids)    — batched for leaderboard/compare
 *
 * Both return commission income only. Priority fees and self-stake
 * delegator yield are tracked separately.
 */

const WEI = BigInt(10) ** BigInt(18);

export interface RealizedIncome {
  validatorId: number;
  /** Earliest claim block we have for this validator (null if no claims yet). */
  firstClaimBlock: bigint | null;
  /** Latest claim block. */
  lastClaimBlock: bigint | null;
  /** Number of claim() events the validator has issued. */
  claimCount: number;
  /** Sum of all claim amounts ever paid out, in MON. */
  totalClaimedMon: number;
  /** Currently sitting in the precompile, claimable any time. */
  currentUnclaimedMon: number;
  /**
   * Lifetime commission = totalClaimed + currentUnclaimed.
   * This is what the validator has actually earned, period.
   */
  totalCommissionMon: number;
  /**
   * Backward-compat fields for callers that pre-date the claim-event indexer.
   * `firstEpoch` / `lastEpoch` are now the epoch bounds of the validator's
   * snapshot history (used for "since X" labeling), `snapshotCount` is the
   * count of epoch_snapshots rows, and `totalPoolMon` is kept as 0 (the
   * old pool×rate projection is gone — we don't compute it anymore).
   */
  firstEpoch: number | null;
  lastEpoch: number | null;
  snapshotCount: number;
  totalPoolMon: number;
}

function weiToMon(wei: bigint): number {
  return Number(wei / WEI) + Number(wei % WEI) / Number(WEI);
}

/**
 * Query the latest unclaimed balance + epoch bounds for one validator
 * from epoch_snapshots. Returns zeros if the validator has no snapshots.
 */
async function getValidatorSnapshotMeta(
  validatorId: number
): Promise<{
  unclaimedWei: bigint;
  firstEpoch: number | null;
  lastEpoch: number | null;
  snapshotCount: number;
}> {
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
      firstEpoch: null,
      lastEpoch: null,
      snapshotCount: 0,
    };
  }
  const latest = await db
    .select({ unclaimed: epochSnapshots.unclaimedRewards })
    .from(epochSnapshots)
    .where(eq(epochSnapshots.validatorId, validatorId))
    .orderBy(desc(epochSnapshots.epoch))
    .limit(1);
  return {
    unclaimedWei: latest.length > 0 ? BigInt(latest[0].unclaimed) : BigInt(0),
    firstEpoch: agg.minE,
    lastEpoch: agg.maxE,
    snapshotCount: Number(agg.cnt),
  };
}

/** Realized commission income for a single validator. */
export async function getRealizedIncome(
  validatorId: number
): Promise<RealizedIncome> {
  // Get auth address.
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
      currentUnclaimedMon: 0,
      totalCommissionMon: 0,
      firstEpoch: null,
      lastEpoch: null,
      snapshotCount: 0,
      totalPoolMon: 0,
    };
  }

  // Sum every ClaimRewards event where the delegator is the validator's
  // auth address. That's the validator paying themselves their commission.
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
  const currentUnclaimedMon = weiToMon(snapMeta.unclaimedWei);
  const totalCommissionMon = totalClaimedMon + currentUnclaimedMon;

  return {
    validatorId,
    firstClaimBlock: firstBlk > BigInt(0) ? firstBlk : null,
    lastClaimBlock: lastBlk > BigInt(0) ? lastBlk : null,
    claimCount,
    totalClaimedMon,
    currentUnclaimedMon,
    totalCommissionMon,
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

  // 1. auth addresses
  const valRows = await db
    .select({
      validatorId: validators.validatorId,
      authAddress: validators.authAddress,
    })
    .from(validators)
    .where(inArray(validators.validatorId, validatorIds));
  const authMap = new Map<number, string>();
  for (const r of valRows) {
    authMap.set(r.validatorId, r.authAddress.toLowerCase());
  }

  // 2. aggregate claim_events per validator (only where delegator == auth).
  // We do a SQL-side filter joining against the validators table to keep
  // delegator-only claims out of the commission sum.
  const claimRows = (await db.execute(sql`
    SELECT
      ce.validator_id AS validator_id,
      COALESCE(SUM(ce.amount_wei), 0)::text AS total_wei,
      COUNT(*)::int AS cnt,
      COALESCE(MIN(ce.block_number), 0)::text AS first_blk,
      COALESCE(MAX(ce.block_number), 0)::text AS last_blk
    FROM claim_events ce
    INNER JOIN validators v
      ON v.validator_id = ce.validator_id
      AND LOWER(v.auth_address) = ce.delegator
    WHERE ce.validator_id = ANY(${validatorIds})
    GROUP BY ce.validator_id
  `)) as unknown as {
    rows: Array<{
      validator_id: number;
      total_wei: string;
      cnt: number;
      first_blk: string;
      last_blk: string;
    }>;
  };

  const claimAgg = new Map<
    number,
    {
      totalWei: bigint;
      cnt: number;
      first: bigint;
      last: bigint;
    }
  >();
  // drizzle's sql.execute returns either an array directly OR { rows: [...] }
  // depending on driver. Normalize.
  const rowsAny = (claimRows as unknown as { rows?: unknown[] }).rows;
  const rowsList: Array<{
    validator_id: number;
    total_wei: string;
    cnt: number;
    first_blk: string;
    last_blk: string;
  }> = Array.isArray(rowsAny)
    ? (rowsAny as Array<{
        validator_id: number;
        total_wei: string;
        cnt: number;
        first_blk: string;
        last_blk: string;
      }>)
    : (claimRows as unknown as Array<{
        validator_id: number;
        total_wei: string;
        cnt: number;
        first_blk: string;
        last_blk: string;
      }>);
  for (const r of rowsList) {
    claimAgg.set(Number(r.validator_id), {
      totalWei: BigInt(r.total_wei),
      cnt: Number(r.cnt),
      first: BigInt(r.first_blk),
      last: BigInt(r.last_blk),
    });
  }

  // 3. latest unclaimed balance + epoch bounds per validator. Window
  //    function pulls the latest snapshot row, plus a separate aggregate
  //    for the snapshot count and epoch bounds.
  const unclaimedRowsRaw = (await db.execute(sql`
    SELECT validator_id, unclaimed_rewards
    FROM (
      SELECT validator_id, unclaimed_rewards,
        ROW_NUMBER() OVER (PARTITION BY validator_id ORDER BY epoch DESC) AS rn
      FROM epoch_snapshots
      WHERE validator_id = ANY(${validatorIds})
    ) t
    WHERE rn = 1
  `)) as unknown as { rows?: unknown[] };
  const unclaimedRowsList: Array<{
    validator_id: number;
    unclaimed_rewards: string;
  }> = Array.isArray(
    (unclaimedRowsRaw as { rows?: unknown[] }).rows
  )
    ? ((unclaimedRowsRaw as { rows: unknown[] }).rows as Array<{
        validator_id: number;
        unclaimed_rewards: string;
      }>)
    : (unclaimedRowsRaw as unknown as Array<{
        validator_id: number;
        unclaimed_rewards: string;
      }>);

  const unclaimedMap = new Map<number, bigint>();
  for (const r of unclaimedRowsList) {
    unclaimedMap.set(Number(r.validator_id), BigInt(r.unclaimed_rewards));
  }

  const snapAggRaw = (await db.execute(sql`
    SELECT validator_id,
      COUNT(*)::int AS cnt,
      MIN(epoch)::int AS min_e,
      MAX(epoch)::int AS max_e
    FROM epoch_snapshots
    WHERE validator_id = ANY(${validatorIds})
    GROUP BY validator_id
  `)) as unknown as { rows?: unknown[] };
  const snapAggList: Array<{
    validator_id: number;
    cnt: number;
    min_e: number;
    max_e: number;
  }> = Array.isArray((snapAggRaw as { rows?: unknown[] }).rows)
    ? ((snapAggRaw as { rows: unknown[] }).rows as Array<{
        validator_id: number;
        cnt: number;
        min_e: number;
        max_e: number;
      }>)
    : (snapAggRaw as unknown as Array<{
        validator_id: number;
        cnt: number;
        min_e: number;
        max_e: number;
      }>);
  const snapMetaMap = new Map<
    number,
    { cnt: number; minE: number; maxE: number }
  >();
  for (const r of snapAggList) {
    snapMetaMap.set(Number(r.validator_id), {
      cnt: Number(r.cnt),
      minE: Number(r.min_e),
      maxE: Number(r.max_e),
    });
  }

  // 4. assemble
  for (const id of validatorIds) {
    const agg = claimAgg.get(id);
    const unclaimedWei = unclaimedMap.get(id) ?? BigInt(0);
    const totalClaimedWei = agg?.totalWei ?? BigInt(0);
    const totalClaimedMon = weiToMon(totalClaimedWei);
    const currentUnclaimedMon = weiToMon(unclaimedWei);
    const sm = snapMetaMap.get(id);
    out.set(id, {
      validatorId: id,
      firstClaimBlock: agg && agg.first > BigInt(0) ? agg.first : null,
      lastClaimBlock: agg && agg.last > BigInt(0) ? agg.last : null,
      claimCount: agg?.cnt ?? 0,
      totalClaimedMon,
      currentUnclaimedMon,
      totalCommissionMon: totalClaimedMon + currentUnclaimedMon,
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

// Re-export asc so callers that imported from drizzle-orm don't need to
// also import the sort helpers from realized-income.
export { asc };
