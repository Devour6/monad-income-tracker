/**
 * Historical snapshot backfill — walks backwards from earliest indexed epoch
 * and reconstructs `epoch_snapshots` rows by calling getValidator(id) at
 * historical block tags via eth_call.
 *
 * Why: the live snapshot cron only started at epoch 1369 (Apr 16). Validators
 * that began producing earlier (e.g. Phase Stake on day-1) have weeks of
 * realized income that the income API cannot see, leading to UI numbers that
 * underreport actual lifetime earnings.
 *
 * Strategy:
 *   1. Find the earliest snapshot epoch in DB (E_min).
 *   2. For each target epoch E in [E_target_min, E_min - 1]:
 *      a. Pick a representative block within epoch E (epoch end - margin).
 *      b. Call getValidator(id) at that block tag for every active validator.
 *      c. Insert rows into epoch_snapshots (idempotent on (epoch, validator_id)).
 *   3. Cap wall-clock per run; advance backward across runs.
 *
 * Each Monad epoch = 50,000 blocks. We use the staking precompile's getEpoch()
 * at a candidate block to confirm we're inside the target epoch before snapshotting.
 *
 * Self-stake: the same getDelegator(id, authAddress) call works historically.
 *
 * Idempotent: ON CONFLICT (epoch, validator_id) DO NOTHING.
 */

import { db } from "@/lib/db";
import { epochSnapshots, validators } from "@/lib/db/schema";
import { sql, asc, eq } from "drizzle-orm";

const MONAD_RPC = process.env.MONAD_RPC_URL || "https://rpc.monad.xyz";
const STAKING_CONTRACT = "0x0000000000000000000000000000000000001000";
const GET_VALIDATOR = "0x2b6d639a";
const GET_DELEGATOR = "0x573c1ce0";
const GET_EPOCH_SELECTOR = "0x757991a8";
const BLOCKS_PER_EPOCH = BigInt(50_000);

// Reasonable safety: stop at this floor unless caller overrides.
// Monad mainnet roughly started near block ~50_000_000; epochs were around 1000.
const DEFAULT_FLOOR_EPOCH = 1100;

const WEI_PER_MON = BigInt(10) ** BigInt(18);

function encUint64(n: bigint): string {
  return n.toString(16).padStart(64, "0");
}

function encAddress(addr: string): string {
  const clean = addr.startsWith("0x") ? addr.slice(2) : addr;
  return clean.toLowerCase().padStart(64, "0");
}

interface RpcCall {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
}

async function rpcSingle<T = string>(
  method: string,
  params: unknown[],
  timeoutMs = 8000
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(MONAD_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    const j = await res.json();
    if (j.error) throw new Error(`RPC: ${j.error.message}`);
    return j.result as T;
  } finally {
    clearTimeout(timer);
  }
}

async function ethCallAt(data: string, blockTag: string): Promise<string> {
  return rpcSingle<string>("eth_call", [
    { to: STAKING_CONTRACT, data },
    blockTag,
  ]);
}

async function getEpochAtBlock(blockNum: bigint): Promise<number> {
  const tag = "0x" + blockNum.toString(16);
  const hex = (await ethCallAt(GET_EPOCH_SELECTOR, tag)).slice(2);
  if (hex.length < 64) throw new Error(`bad epoch reply at block ${blockNum}`);
  return Number(BigInt("0x" + hex.slice(0, 64)));
}

interface HistoricalSnap {
  validatorId: number;
  authAddress: string;
  stakeWei: bigint;
  accRewardPerToken: bigint;
  commission: bigint;
  unclaimedRewards: bigint;
}

function decodeValidator(hex: string, validatorId: number): HistoricalSnap {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const slot = (n: number) => BigInt("0x" + h.slice(n * 64, (n + 1) * 64));
  return {
    validatorId,
    authAddress: "0x" + h.slice(24, 64),
    stakeWei: slot(2),
    accRewardPerToken: slot(3),
    commission: slot(4),
    unclaimedRewards: slot(5),
  };
}

function decodeDelegatorStake(hex: string): bigint {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length < 64) return BigInt(0);
  return BigInt("0x" + h.slice(0, 64));
}

/**
 * Find a block that lives inside the target epoch.
 * Uses linear search by stepping back BLOCKS_PER_EPOCH at a time from
 * a known anchor (currentBlock, currentEpoch). Cheap because each
 * eth_call is one round-trip and we cache nothing across runs.
 */
async function findBlockInEpoch(
  targetEpoch: number,
  anchorBlock: bigint,
  anchorEpoch: number
): Promise<bigint | null> {
  if (targetEpoch >= anchorEpoch) return null;
  // Estimate: anchorBlock - (anchorEpoch - targetEpoch) * 50000 - 1000 (mid-epoch)
  const epochDelta = BigInt(anchorEpoch - targetEpoch);
  let candidate = anchorBlock - epochDelta * BLOCKS_PER_EPOCH;
  if (candidate <= BigInt(0)) return null;

  // Confirm by sampling. Walk forward/backward by half-epoch steps until match.
  for (let attempts = 0; attempts < 8; attempts++) {
    if (candidate <= BigInt(0)) return null;
    const e = await getEpochAtBlock(candidate);
    if (e === targetEpoch) return candidate;
    if (e > targetEpoch) {
      candidate -= BLOCKS_PER_EPOCH / BigInt(2);
    } else {
      candidate += BLOCKS_PER_EPOCH / BigInt(2);
    }
  }
  return null;
}

interface BackfillRunOpts {
  /** Earliest epoch to backfill down to (inclusive). Default: 1100. */
  floorEpoch?: number;
  /** Hard wall-clock budget in ms. Default: 50_000 (Vercel-safe). */
  budgetMs?: number;
  /** Max validators to snapshot per epoch (chunked). Default: all. */
  maxPerEpoch?: number;
}

interface BackfillRunResult {
  startedAt: string;
  durationMs: number;
  earliestExistingEpoch: number;
  earliestExistingBlock: bigint | null;
  epochsBackfilled: number[];
  rowsInserted: number;
  rpcCalls: number;
  hitFloor: boolean;
  hitBudget: boolean;
  error: string | null;
}

export async function runHistoricalSnapshotBackfill(
  opts: BackfillRunOpts = {}
): Promise<BackfillRunResult> {
  const t0 = Date.now();
  const budgetMs = opts.budgetMs ?? 50_000;
  const floorEpoch = opts.floorEpoch ?? DEFAULT_FLOOR_EPOCH;
  let rpcCalls = 0;
  const epochsBackfilled: number[] = [];
  let rowsInserted = 0;
  let hitFloor = false;
  let hitBudget = false;
  let error: string | null = null;

  try {
    // 1. Find earliest existing snapshot.
    const earliestRows = await db
      .select({ epoch: epochSnapshots.epoch })
      .from(epochSnapshots)
      .orderBy(asc(epochSnapshots.epoch))
      .limit(1);
    if (earliestRows.length === 0) {
      throw new Error("No existing snapshots; cannot anchor backfill.");
    }
    const earliestEpoch = earliestRows[0].epoch;

    // 2. Find an anchor: latest known block + epoch from chain head.
    const headHex = await rpcSingle<string>("eth_blockNumber", []);
    rpcCalls += 1;
    const headBlock = BigInt(headHex);
    const headEpoch = await getEpochAtBlock(headBlock);
    rpcCalls += 1;

    // 3. Pull validator list once — we use the same auth addresses across all
    //    historical epochs. Validators that didn't exist at a given epoch
    //    will return zeroed responses; we filter those.
    const valRows = await db.select().from(validators);
    const validatorList = valRows.map((v) => ({
      validatorId: v.validatorId,
      authAddress: v.authAddress,
    }));
    if (validatorList.length === 0) {
      throw new Error("No validators in DB; cannot backfill.");
    }

    // 4. Walk backward from earliestEpoch - 1 down to floorEpoch.
    for (let e = earliestEpoch - 1; e >= floorEpoch; e--) {
      if (Date.now() - t0 > budgetMs) {
        hitBudget = true;
        break;
      }

      const block = await findBlockInEpoch(e, headBlock, headEpoch);
      rpcCalls += 4; // approx per find
      if (!block) {
        // Pre-genesis or unreachable; treat as floor.
        hitFloor = true;
        break;
      }
      const blockTag = "0x" + block.toString(16);

      // 5. Fetch validator state at that block tag.
      const slice = opts.maxPerEpoch
        ? validatorList.slice(0, opts.maxPerEpoch)
        : validatorList;

      const CONCURRENCY = 10;
      const snaps: HistoricalSnap[] = [];
      const selfStakes = new Map<number, bigint>();

      for (let i = 0; i < slice.length; i += CONCURRENCY) {
        if (Date.now() - t0 > budgetMs) {
          hitBudget = true;
          break;
        }
        const chunk = slice.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(
          chunk.map(async (v) => {
            const data = GET_VALIDATOR + encUint64(BigInt(v.validatorId));
            const hex = await ethCallAt(data, blockTag);
            return decodeValidator(hex, v.validatorId);
          })
        );
        rpcCalls += chunk.length;
        for (const r of settled) {
          if (r.status === "fulfilled") {
            const s = r.value;
            // Skip validators that didn't exist yet (auth=0x0)
            if (s.authAddress.toLowerCase() === "0x0000000000000000000000000000000000000000") continue;
            // Skip zero-stake (likely not active in this epoch)
            if (s.stakeWei === BigInt(0)) continue;
            snaps.push(s);
          }
        }

        // Self-stake batch in same chunk
        const selfSettled = await Promise.allSettled(
          chunk.map(async (v) => {
            const data =
              GET_DELEGATOR +
              encUint64(BigInt(v.validatorId)) +
              encAddress(v.authAddress);
            const hex = await ethCallAt(data, blockTag);
            return { id: v.validatorId, stakeWei: decodeDelegatorStake(hex) };
          })
        );
        rpcCalls += chunk.length;
        for (const r of selfSettled) {
          if (r.status === "fulfilled") {
            selfStakes.set(r.value.id, r.value.stakeWei);
          }
        }
      }

      if (hitBudget) break;

      // 6. Insert.
      if (snaps.length > 0) {
        const rows = snaps.map((s) => ({
          epoch: e,
          validatorId: s.validatorId,
          accRewardPerToken: s.accRewardPerToken.toString(),
          stakeWei: s.stakeWei.toString(),
          commission: s.commission.toString(),
          unclaimedRewards: s.unclaimedRewards.toString(),
          selfStakeWei: (selfStakes.get(s.validatorId) ?? BigInt(0)).toString(),
        }));

        const result = await db
          .insert(epochSnapshots)
          .values(rows)
          .onConflictDoNothing();
        const inserted = (result as { rowCount?: number }).rowCount ?? rows.length;
        rowsInserted += inserted;
        epochsBackfilled.push(e);
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return {
    startedAt: new Date(t0).toISOString(),
    durationMs: Date.now() - t0,
    earliestExistingEpoch: 0,
    earliestExistingBlock: null,
    epochsBackfilled,
    rowsInserted,
    rpcCalls,
    hitFloor,
    hitBudget,
    error,
  };
}

/**
 * Lighter helper used by the income API's "lifetime" endpoint:
 * given a validator ID, returns earliest epoch we have any snapshot for them.
 */
export async function getValidatorEarliestEpoch(
  validatorId: number
): Promise<number | null> {
  const rows = await db
    .select({ epoch: epochSnapshots.epoch })
    .from(epochSnapshots)
    .where(eq(epochSnapshots.validatorId, validatorId))
    .orderBy(asc(epochSnapshots.epoch))
    .limit(1);
  return rows.length > 0 ? rows[0].epoch : null;
}

/**
 * For diagnostics: returns counts of snapshots per epoch in a range.
 */
export async function getSnapshotCoverage(
  fromEpoch: number,
  toEpoch: number
): Promise<{ epoch: number; count: number }[]> {
  const rows = (await db
    .select({
      epoch: epochSnapshots.epoch,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(epochSnapshots)
    .where(
      sql`${epochSnapshots.epoch} >= ${fromEpoch} AND ${epochSnapshots.epoch} <= ${toEpoch}`
    )
    .groupBy(epochSnapshots.epoch)
    .orderBy(asc(epochSnapshots.epoch))) as unknown as {
    epoch: number;
    count: number;
  }[];
  return rows;
}
