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
 */

const WEI = BigInt(10) ** BigInt(18);

export interface RealizedIncome {
  validatorId: number;
  firstClaimBlock: bigint | null;
  lastClaimBlock: bigint | null;
  claimCount: number;
  totalClaimedMon: number;
  currentUnclaimedMon: number;
  /** Lifetime commission = totalClaimed + currentUnclaimed. */
  totalCommissionMon: number;
  /** Backward-compat for callers that pre-date claim_events. */
  firstEpoch: number | null;
  lastEpoch: number | null;
  snapshotCount: number;
  totalPoolMon: number;
}

function weiToMon(wei: bigint): number {
  return Number(wei / WEI) + Number(wei % WEI) / Number(WEI);
}

/**
 * Build a parameterized SQL IN-list from a JS array of integers. Drizzle's
 * `${arr}` interpolation in template `sql` doesn't auto-cast a JS array to
 * `int[]` for use with PG's `ANY()` operator, so the prior approach
 * (`WHERE x = ANY(${ids})`) failed at runtime with
 * `op ANY/ALL (array) requires array on right side`. Using sql.join with
 * scalar parameters gives us a normal `IN (?, ?, ?)` clause that always
 * binds correctly regardless of driver.
 */
function inListInt(ids: number[]) {
  // ids must already be validated as integers by callers (URL parser).
  // sql.join handles parameter binding safely.
  return sql.join(
    ids.map((n) => sql`${n}`),
    sql.raw(", ")
  );
}

/** Latest unclaimed balance + epoch bounds for one validator. */
async function getValidatorSnapshotMeta(validatorId: number): Promise<{
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

interface RawRows {
  rows?: unknown[];
}
function rowsOf<T>(result: unknown): T[] {
  // drizzle's neon driver returns either array or {rows: array}. Normalize.
  const r = result as RawRows;
  if (Array.isArray(r?.rows)) return r.rows as T[];
  if (Array.isArray(result)) return result as T[];
  return [];
}

/** Batched lookup for leaderboard/compare endpoints. */
export async function getRealizedIncomeBatch(
  validatorIds: number[]
): Promise<Map<number, RealizedIncome>> {
  const out = new Map<number, RealizedIncome>();
  if (validatorIds.length === 0) return out;

  // Validate every id is a finite int — defensive, callers should already
  // have parsed via parseInt + filter, but inListInt does no escaping.
  const safeIds = validatorIds.filter((n) => Number.isInteger(n) && n >= 0);
  if (safeIds.length === 0) return out;

  // 1. auth addresses
  const valRows = await db
    .select({
      validatorId: validators.validatorId,
      authAddress: validators.authAddress,
    })
    .from(validators)
    .where(inArray(validators.validatorId, safeIds));
  const authMap = new Map<number, string>();
  for (const r of valRows) {
    authMap.set(r.validatorId, r.authAddress.toLowerCase());
  }

  // 2. aggregate claim_events per validator (only where delegator == auth).
  // The JOIN on validators ensures we sum only the validator's own claims,
  // not third-party delegators claiming their stake yield.
  const claimRowsRaw = await db.execute(sql`
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
    WHERE ce.validator_id IN (${inListInt(safeIds)})
    GROUP BY ce.validator_id
  `);
  const claimRows = rowsOf<{
    validator_id: number;
    total_wei: string;
    cnt: number;
    first_blk: string;
    last_blk: string;
  }>(claimRowsRaw);

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

  // 3. latest unclaimed balance per validator + snapshot epoch bounds.
  const unclaimedRowsRaw = await db.execute(sql`
    SELECT validator_id, unclaimed_rewards
    FROM (
      SELECT validator_id, unclaimed_rewards,
        ROW_NUMBER() OVER (PARTITION BY validator_id ORDER BY epoch DESC) AS rn
      FROM epoch_snapshots
      WHERE validator_id IN (${inListInt(safeIds)})
    ) t
    WHERE rn = 1
  `);
  const unclaimedRows = rowsOf<{
    validator_id: number;
    unclaimed_rewards: string;
  }>(unclaimedRowsRaw);
  const unclaimedMap = new Map<number, bigint>();
  for (const r of unclaimedRows) {
    unclaimedMap.set(Number(r.validator_id), BigInt(r.unclaimed_rewards));
  }

  const snapAggRaw = await db.execute(sql`
    SELECT validator_id,
      COUNT(*)::int AS cnt,
      MIN(epoch)::int AS min_e,
      MAX(epoch)::int AS max_e
    FROM epoch_snapshots
    WHERE validator_id IN (${inListInt(safeIds)})
    GROUP BY validator_id
  `);
  const snapAggRows = rowsOf<{
    validator_id: number;
    cnt: number;
    min_e: number;
    max_e: number;
  }>(snapAggRaw);
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

  // 4. assemble
  for (const id of safeIds) {
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

/** Per-claim-event detail for the dashboard claim history table. */
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
