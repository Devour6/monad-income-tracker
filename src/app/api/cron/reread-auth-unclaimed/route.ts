import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

/**
 * GET /api/cron/reread-auth-unclaimed
 *
 * Re-reads epoch_snapshots.auth_unclaimed_wei at a DETERMINISTIC block height
 * (epoch_end - 10) for recently closed epochs. The live snapshot cron samples
 * getDelegator at "current block" every 15 min, which means within a single
 * epoch (5.5h / ~22 cron runs) we keep overwriting the row with samples from
 * different points in the epoch's lifetime. Adjacent epochs end up with
 * non-monotonic auth_unclaimed values, producing phantom "no income" gaps
 * in the chart even though on-chain accrual is smooth.
 *
 * This cron picks the canonical reading at epoch_end - 10 blocks for every
 * closed epoch in the recent window and overwrites the noisy live-cron value.
 *
 * Idempotent. Safe to run as often as you want.
 *
 * Auth: Bearer CRON_SECRET (same scheme as other cron routes).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RPC =
  process.env.MONAD_RPC_URL || "https://rpc.monad.xyz";
const STAKING = "0x0000000000000000000000000000000000001000";
const GET_DELEGATOR = "573c1ce0";
const GET_EPOCH_SELECTOR = "0x757991a8";
const EPOCH_LEN = BigInt(50000);
const EPOCH_END_MARGIN = BigInt(10);

// Window: re-read the last N closed epochs each run. The live cron is what
// makes the in-progress epoch row exist at all; this cron just canonicalizes
// it once it closes. Keeping the window small (8 closed epochs ≈ 2 days) keeps
// each run fast — under 60s function timeout.
const REREAD_LAST_N_EPOCHS = 8;

function encodeUint64(n: bigint): string {
  return n.toString(16).padStart(64, "0");
}
function encodeAddress(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}
function buildCalldata(valId: number, auth: string): string {
  return "0x" + GET_DELEGATOR + encodeUint64(BigInt(valId)) + encodeAddress(auth);
}

interface RpcBatchReq {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
}
interface RpcBatchResp {
  jsonrpc: "2.0";
  id: number;
  result?: string;
  error?: { code: number; message: string };
}

async function rpcBatch(reqs: RpcBatchReq[]): Promise<RpcBatchResp[]> {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqs),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as RpcBatchResp[];
}

async function rpcSingle(method: string, params: unknown[]): Promise<string> {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { result?: string };
  return j.result ?? "";
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  const BUDGET_MS = 50_000;

  try {
    // Anchor + chain head
    const headHex = await rpcSingle("eth_blockNumber", []);
    const headBlock = BigInt(headHex);
    const currentEpochHex = await rpcSingle("eth_call", [
      { to: STAKING, data: GET_EPOCH_SELECTOR },
      "0x" + headBlock.toString(16),
    ]);
    const currentEpoch = Number(
      BigInt("0x" + currentEpochHex.slice(2, 66))
    );

    const anchorRows = (await db.execute(sql`
      SELECT epoch, MIN(first_block)::text AS first_blk
        FROM epoch_priority_fees
       GROUP BY epoch
       ORDER BY epoch ASC
       LIMIT 1
    `)) as unknown as { rows?: Array<{ epoch: number; first_blk: string }> };
    const anchorList = Array.isArray(
      (anchorRows as { rows?: unknown[] }).rows
    )
      ? ((anchorRows as { rows: unknown[] }).rows as Array<{
          epoch: number;
          first_blk: string;
        }>)
      : (anchorRows as unknown as Array<{ epoch: number; first_blk: string }>);
    if (anchorList.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "no anchor from epoch_priority_fees",
      });
    }
    const anchorEpoch = BigInt(anchorList[0].epoch);
    const anchorBlock = BigInt(anchorList[0].first_blk);

    // Validators with auth addresses
    const valRows = (await db.execute(sql`
      SELECT validator_id, auth_address FROM validators
    `)) as unknown as {
      rows?: Array<{ validator_id: number; auth_address: string }>;
    };
    const validators = Array.isArray(
      (valRows as { rows?: unknown[] }).rows
    )
      ? ((valRows as { rows: unknown[] }).rows as Array<{
          validator_id: number;
          auth_address: string;
        }>)
      : (valRows as unknown as Array<{
          validator_id: number;
          auth_address: string;
        }>);

    const targetEpochs: number[] = [];
    for (let e = currentEpoch - REREAD_LAST_N_EPOCHS; e < currentEpoch; e++) {
      if (e > 0) targetEpochs.push(e);
    }

    let totalUpdated = 0;
    let totalFailed = 0;
    const epochResults: Array<{
      epoch: number;
      updated: number;
      failed: number;
    }> = [];

    for (const epoch of targetEpochs) {
      if (Date.now() - t0 > BUDGET_MS) break;

      const ep = BigInt(epoch);
      const epochEnd = anchorBlock + (ep - anchorEpoch + BigInt(1)) * EPOCH_LEN - BigInt(1);
      const sampleBlock = epochEnd - EPOCH_END_MARGIN;
      if (sampleBlock > headBlock) continue;

      let updated = 0;
      let failed = 0;
      const BATCH = 50;
      for (let i = 0; i < validators.length; i += BATCH) {
        if (Date.now() - t0 > BUDGET_MS) break;
        const slice = validators.slice(i, i + BATCH);
        const reqs: RpcBatchReq[] = slice.map((v, j) => ({
          jsonrpc: "2.0",
          id: j,
          method: "eth_call",
          params: [
            { to: STAKING, data: buildCalldata(v.validator_id, v.auth_address) },
            "0x" + sampleBlock.toString(16),
          ],
        }));
        let resps: RpcBatchResp[];
        try {
          resps = await rpcBatch(reqs);
        } catch {
          failed += slice.length;
          continue;
        }
        for (const resp of resps) {
          const v = slice[resp.id];
          if (resp.error || !resp.result || resp.result === "0x") {
            failed++;
            continue;
          }
          const h = resp.result.startsWith("0x")
            ? resp.result.slice(2)
            : resp.result;
          if (h.length < 192) {
            failed++;
            continue;
          }
          const wei = BigInt("0x" + h.slice(128, 192)).toString();
          try {
            await db.execute(sql`
              UPDATE epoch_snapshots
                 SET auth_unclaimed_wei = ${wei}
               WHERE epoch = ${epoch}
                 AND validator_id = ${v.validator_id}
            `);
            updated++;
          } catch {
            failed++;
          }
        }
      }
      totalUpdated += updated;
      totalFailed += failed;
      epochResults.push({ epoch, updated, failed });
    }

    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - t0,
      currentEpoch,
      headBlock: headBlock.toString(),
      anchor: {
        epoch: Number(anchorEpoch),
        block: anchorBlock.toString(),
      },
      epochsProcessed: epochResults.length,
      epochResults,
      totalUpdated,
      totalFailed,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - t0,
      },
      { status: 500 }
    );
  }
}
