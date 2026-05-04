import { db } from "@/lib/db";
import { claimEvents } from "@/lib/db/claim-events-schema";
import { epochSnapshots, validators } from "@/lib/db/schema";
import { sql, eq, asc, desc, and, gte, lte } from "drizzle-orm";

/**
 * Realized income — REAL on-chain income tracking. No modeling. No projections.
 *
 * The headline number is the literal sum of every `ClaimRewards` event
 * emitted by the staking precompile where `delegator == validator.auth_address`.
 * Each row in `claim_events` is a real transaction the validator's auth
 * address signed. Auditable on-chain.
 *
 * What about pending rewards?
 * ---------------------------
 * The staking precompile's `unclaimedRewards` slot is the WHOLE pool's pending
 * balance — proven empirically: Backpack runs 0% commission and still has
 * 6M+ MON in unclaimedRewards (that's all delegator yield, not commission).
 *
 * We CANNOT decompose `unclaimedRewards` into "validator's share" without
 * knowing the precompile's exact distribution formula, which Monad docs
 * don't fully specify. Rather than fabricate a number, we report:
 *
 *   - `totalClaimedMon`   = exactly what the validator has withdrawn
 *                           (sum of auth-address ClaimRewards events)
 *   - `poolUnclaimedMon`  = the entire pool's pending balance
 *                           (informational — your share TBD on claim)
 *
 * The dashboard uses `totalClaimedMon` as the headline lifetime income.
 * Pool unclaimed is shown separately and labeled as "pool pending —
 * distributed to delegators on next claim."
 */

const WEI = BigInt(10) ** BigInt(18);

export interface RealizedIncome {
  validatorId: number;
  /** Earliest auth-address claim block (null if no claims yet). */
  firstClaimBlock: bigint | null;
  /** Latest auth-address claim block. */
  lastClaimBlock: bigint | null;
  /** Number of ClaimRewards events the auth address has issued. */
  claimCount: number;
  /**
   * Sum of all auth-address claim amounts ever paid out, in MON.
   * THE HEADLINE NUMBER. Every wei is on-chain and traceable.
   */
  totalClaimedMon: number;
  /**
   * Whole pool's currently unclaimed balance from getValidator() slot 5.
   * Informational only — represents pending rewards across all delegators
   * (including the validator's auth-address share). Not counted as
   * validator income because we cannot decompose it.
   */
  poolUnclaimedMon: number;
  /** Backward-compat alias for `totalClaimedMon`. */
  totalCommissionMon: number;
  /** Backward-compat alias — DEPRECATED, equals poolUnclaimedMon. */
  currentUnclaimedMon: number;
  firstEpoch: number | null;
  lastEpoch: number | null;
  snapshotCount: number;
}

function weiToMon(wei: bigint): number {
  return Number(wei / WEI) + Number(wei % WEI) / Number(WEI);
}

interface SnapMeta {
  unclaimedWei: bigint;
  firstEpoch: number | null;
  lastEpoch: number | null;
  snapshotCount: number;
}

async function getSnapMeta(validatorId: number): Promise<SnapMeta> {
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

/** Realized income for a single validator. */
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
      poolUnclaimedMon: 0,
      totalCommissionMon: 0,
      currentUnclaimedMon: 0,
      firstEpoch: null,
      lastEpoch: null,
      snapshotCount: 0,
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

  const snapMeta = await getSnapMeta(validatorId);

  const totalClaimedMon = weiToMon(totalClaimedWei);
  const poolUnclaimedMon = weiToMon(snapMeta.unclaimedWei);

  return {
    validatorId,
    firstClaimBlock: firstBlk > BigInt(0) ? firstBlk : null,
    lastClaimBlock: lastBlk > BigInt(0) ? lastBlk : null,
    claimCount,
    totalClaimedMon,
    poolUnclaimedMon,
    totalCommissionMon: totalClaimedMon, // alias — claimed only
    currentUnclaimedMon: poolUnclaimedMon, // alias — pool only
    firstEpoch: snapMeta.firstEpoch,
    lastEpoch: snapMeta.lastEpoch,
    snapshotCount: snapMeta.snapshotCount,
  };
}

/** Batched lookup for leaderboard/compare endpoints. */
export async function getRealizedIncomeBatch(
  validatorIds: number[]
): Promise<Map<number, RealizedIncome>> {
  const out = new Map<number, RealizedIncome>();
  if (validatorIds.length === 0) return out;

  // Validate IDs are positive integers (defense against injection via raw IN).
  const safeIds = validatorIds.filter(
    (n) => Number.isInteger(n) && n > 0
  );
  if (safeIds.length === 0) return out;

  // 1. auth addresses
  const valRows = await db
    .select({
      validatorId: validators.validatorId,
      authAddress: validators.authAddress,
    })
    .from(validators)
    .where(
      sql.raw(
        `validator_id IN (${safeIds.map((n) => String(n)).join(",")})`
      )
    );
  const authMap = new Map<number, string>();
  for (const v of valRows) {
    authMap.set(v.validatorId, v.authAddress.toLowerCase());
  }

  // 2. Aggregate auth-address claims per validator.
  const claimRowsRaw = (await db.execute(sql`
    SELECT ce.validator_id,
      COALESCE(SUM(ce.amount_wei), 0)::text AS total_wei,
      COUNT(*)::int AS cnt,
      COALESCE(MIN(ce.block_number), 0)::text AS first_blk,
      COALESCE(MAX(ce.block_number), 0)::text AS last_blk
    FROM claim_events ce
    INNER JOIN validators v
      ON v.validator_id = ce.validator_id
      AND LOWER(v.auth_address) = ce.delegator
    WHERE ce.validator_id IN (${sql.raw(
      safeIds.map((n) => String(n)).join(",")
    )})
    GROUP BY ce.validator_id
  `)) as unknown as { rows?: unknown[] };
  const claimRowsList: Array<{
    validator_id: number;
    total_wei: string;
    cnt: number;
    first_blk: string;
    last_blk: string;
  }> = Array.isArray((claimRowsRaw as { rows?: unknown[] }).rows)
    ? ((claimRowsRaw as { rows: unknown[] }).rows as Array<{
        validator_id: number;
        total_wei: string;
        cnt: number;
        first_blk: string;
        last_blk: string;
      }>)
    : (claimRowsRaw as unknown as Array<{
        validator_id: number;
        total_wei: string;
        cnt: number;
        first_blk: string;
        last_blk: string;
      }>);

  const claimAgg = new Map<
    number,
    { totalWei: bigint; cnt: number; first: bigint; last: bigint }
  >();
  for (const r of claimRowsList) {
    claimAgg.set(Number(r.validator_id), {
      totalWei: BigInt(r.total_wei),
      cnt: Number(r.cnt),
      first: BigInt(r.first_blk),
      last: BigInt(r.last_blk),
    });
  }

  // 3. Latest unclaimed per validator + snapshot meta.
  const unclaimedRowsRaw = (await db.execute(sql`
    SELECT validator_id, unclaimed_rewards
    FROM (
      SELECT validator_id, unclaimed_rewards,
        ROW_NUMBER() OVER (PARTITION BY validator_id ORDER BY epoch DESC) AS rn
      FROM epoch_snapshots
      WHERE validator_id IN (${sql.raw(
        safeIds.map((n) => String(n)).join(",")
      )})
    ) t
    WHERE rn = 1
  `)) as unknown as { rows?: unknown[] };
  const unclaimedRowsList: Array<{
    validator_id: number;
    unclaimed_rewards: string;
  }> = Array.isArray((unclaimedRowsRaw as { rows?: unknown[] }).rows)
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
    WHERE validator_id IN (${sql.raw(
      safeIds.map((n) => String(n)).join(",")
    )})
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

  // 4. Assemble.
  for (const id of safeIds) {
    const agg = claimAgg.get(id);
    const unclaimedWei = unclaimedMap.get(id) ?? BigInt(0);
    const totalClaimedWei = agg?.totalWei ?? BigInt(0);
    const totalClaimedMon = weiToMon(totalClaimedWei);
    const poolUnclaimedMon = weiToMon(unclaimedWei);
    const sm = snapMetaMap.get(id);
    out.set(id, {
      validatorId: id,
      firstClaimBlock: agg && agg.first > BigInt(0) ? agg.first : null,
      lastClaimBlock: agg && agg.last > BigInt(0) ? agg.last : null,
      claimCount: agg?.cnt ?? 0,
      totalClaimedMon,
      poolUnclaimedMon,
      totalCommissionMon: totalClaimedMon,
      currentUnclaimedMon: poolUnclaimedMon,
      firstEpoch: sm?.minE ?? null,
      lastEpoch: sm?.maxE ?? null,
      snapshotCount: sm?.cnt ?? 0,
    });
  }

  return out;
}

/** Per-claim-event detail for a validator. Returns most recent first. */
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
