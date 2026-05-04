import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epochSnapshots, validators } from "@/lib/db/schema";

/**
 * POST /api/admin/fill-gaps?budgetMs=55000&fromEpoch=1370&toEpoch=1446
 *
 * Fills MISSING epochs within an existing range using historical state from
 * an archive RPC. Different from /api/admin/backfill-snapshots which walks
 * BEFORE the earliest existing epoch — this fills gaps between existing rows.
 *
 * Auth: Bearer CRON_SECRET.
 *
 * Algorithm:
 *  1. Query DB for epochs already covered in [fromEpoch, toEpoch]
 *  2. Compute missing epochs in that range
 *  3. For each missing epoch (oldest first), find a block in that epoch
 *     and snapshot every validator at that block tag.
 *  4. Stop on time budget or unrecoverable RPC error.
 */

const STAKING_CONTRACT = "0x0000000000000000000000000000000000001000";
const GET_EPOCH_SELECTOR = "0x757991a8";
const GET_VALIDATOR = "0x2b6d639a";
const GET_DELEGATOR = "0x573c1ce0";

function encUint64(n: bigint): string {
  return n.toString(16).padStart(64, "0");
}
function encAddress(addr: string): string {
  const clean = addr.startsWith("0x") ? addr.slice(2) : addr;
  return clean.toLowerCase().padStart(64, "0");
}

async function rpc(method: string, params: unknown[]): Promise<string> {
  const url = process.env.MONAD_RPC_URL || "https://rpc.monad.xyz";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
    });
    const j = await res.json();
    if (j.error) throw new Error(`RPC: ${j.error.message}`);
    return j.result as string;
  } finally {
    clearTimeout(t);
  }
}

async function ethCallAt(data: string, blockTag: string): Promise<string> {
  return rpc("eth_call", [{ to: STAKING_CONTRACT, data }, blockTag]);
}

async function getEpochAtBlock(blockNum: bigint): Promise<number> {
  const tag = "0x" + blockNum.toString(16);
  const hex = (await ethCallAt(GET_EPOCH_SELECTOR, tag)).slice(2);
  if (hex.length < 64) throw new Error(`bad epoch reply at block ${blockNum}`);
  return Number(BigInt("0x" + hex.slice(0, 64)));
}

/**
 * Bisect to find any block belonging to targetEpoch.
 * Anchor: a known (block, epoch) pair from chain head.
 * Monad has ~50000 blocks/epoch.
 */
async function findBlockInEpoch(
  targetEpoch: number,
  anchorBlock: bigint,
  anchorEpoch: number
): Promise<bigint | null> {
  if (targetEpoch >= anchorEpoch) return null;
  const epochDelta = BigInt(anchorEpoch - targetEpoch);
  let candidate = anchorBlock - epochDelta * BigInt(50000);
  // Up to 6 probes to land in the target epoch.
  for (let i = 0; i < 6; i++) {
    if (candidate < BigInt(1)) return null;
    let e: number;
    try {
      e = await getEpochAtBlock(candidate);
    } catch {
      return null;
    }
    if (e === targetEpoch) return candidate;
    if (e > targetEpoch) {
      candidate -= BigInt((e - targetEpoch) * 50000);
    } else {
      candidate += BigInt((targetEpoch - e) * 50000);
    }
  }
  return null;
}

function decodeValidator(hex: string, validatorId: number): {
  validatorId: number;
  authAddress: string;
  stakeWei: bigint;
  accRewardPerToken: bigint;
  commission: bigint;
  unclaimedRewards: bigint;
} {
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

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const budgetMs = Math.min(
    Math.max(5000, Number(url.searchParams.get("budgetMs") || "55000")),
    300_000
  );
  const fromEpoch = Number(url.searchParams.get("fromEpoch") || "1370");
  const toEpoch = Number(url.searchParams.get("toEpoch") || "1500");

  const t0 = Date.now();
  const epochsFilled: number[] = [];
  const epochsFailed: Array<{ epoch: number; reason: string }> = [];
  let rowsInserted = 0;
  let rpcCalls = 0;
  let hitBudget = false;
  let firstError: string | null = null;

  try {
    // 1. Find missing epochs.
    const existing = await db
      .selectDistinct({ epoch: epochSnapshots.epoch })
      .from(epochSnapshots);
    const have = new Set(existing.map((r) => r.epoch));
    const missing: number[] = [];
    for (let e = fromEpoch; e <= toEpoch; e++) {
      if (!have.has(e)) missing.push(e);
    }
    if (missing.length === 0) {
      return NextResponse.json({
        message: "No missing epochs in range.",
        fromEpoch,
        toEpoch,
        durationMs: Date.now() - t0,
      });
    }

    // 2. Validator list once.
    const valRows = await db.select().from(validators);
    const validatorList = valRows.map((v) => ({
      validatorId: v.validatorId,
      authAddress: v.authAddress,
    }));

    // 3. Anchor.
    const headHex = await rpc("eth_blockNumber", []);
    rpcCalls += 1;
    const headBlock = BigInt(headHex);
    const headEpoch = await getEpochAtBlock(headBlock);
    rpcCalls += 1;

    // 4. Walk the missing list (oldest first → if we hit archive floor we
    //    surface that quickly and stop).
    for (const e of missing) {
      if (Date.now() - t0 > budgetMs) {
        hitBudget = true;
        break;
      }

      let block: bigint | null;
      try {
        block = await findBlockInEpoch(e, headBlock, headEpoch);
        rpcCalls += 4;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        epochsFailed.push({ epoch: e, reason: msg });
        if (firstError == null) firstError = msg;
        // If RPC is rejecting historical state, deeper epochs will too.
        if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("historical")) {
          break;
        }
        continue;
      }
      if (!block) {
        epochsFailed.push({ epoch: e, reason: "no block found" });
        continue;
      }
      const blockTag = "0x" + block.toString(16);

      // 5. Fetch validator state at that block.
      const CONCURRENCY = 12;
      const snaps: Array<ReturnType<typeof decodeValidator>> = [];
      const selfStakes = new Map<number, bigint>();
      let epochError: string | null = null;

      for (let i = 0; i < validatorList.length; i += CONCURRENCY) {
        if (Date.now() - t0 > budgetMs) {
          hitBudget = true;
          break;
        }
        const chunk = validatorList.slice(i, i + CONCURRENCY);
        const vSettled = await Promise.allSettled(
          chunk.map(async (v) => {
            const data = GET_VALIDATOR + encUint64(BigInt(v.validatorId));
            const hex = await ethCallAt(data, blockTag);
            return decodeValidator(hex, v.validatorId);
          })
        );
        rpcCalls += chunk.length;
        for (const r of vSettled) {
          if (r.status === "fulfilled" && r.value.stakeWei > BigInt(0)) {
            snaps.push(r.value);
          } else if (r.status === "rejected" && epochError == null) {
            const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
            if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("historical")) {
              epochError = msg;
            }
          }
        }
        if (epochError) break;

        const sSettled = await Promise.allSettled(
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
        for (const r of sSettled) {
          if (r.status === "fulfilled") {
            selfStakes.set(r.value.id, r.value.stakeWei);
          }
        }
      }

      if (epochError) {
        epochsFailed.push({ epoch: e, reason: epochError });
        if (firstError == null) firstError = epochError;
        // archive floor reached — bail
        break;
      }
      if (hitBudget) break;

      if (snaps.length === 0) {
        epochsFailed.push({ epoch: e, reason: "no validators returned data" });
        continue;
      }

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
      epochsFilled.push(e);
    }
  } catch (err) {
    firstError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({
    startedAt: new Date(t0).toISOString(),
    durationMs: Date.now() - t0,
    fromEpoch,
    toEpoch,
    epochsFilled,
    epochsFailed: epochsFailed.slice(0, 10),
    rowsInserted,
    rpcCalls,
    hitBudget,
    firstError,
  });
}
