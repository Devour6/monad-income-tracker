/**
 * Self-healing snapshot gap filler.
 *
 * Scans the last 30 closed epochs for ANY (epoch, validator) pair that's
 * missing from epoch_snapshots, then refetches via getValidator + getDelegator
 * at the canonical (epoch_end - 10) block tag and inserts the row.
 *
 * This is the safety net for the failure mode the tester kept catching:
 * the snapshot cron OR the missing-snapshots backfill RPC-failing for some
 * subset of validators in a given epoch, then never retrying, leaving silent
 * gaps that show as "no income" rows on the chart.
 *
 * Idempotent — only fills missing rows, never overwrites existing data.
 * Runs hourly via GH Actions.
 *
 * Slot decoding matches src/lib/monad-rpc.ts:decodeValidatorResponse exactly:
 *   getValidator(uint64): slot 0 = authAddress, slot 2 = stakeWei,
 *     slot 3 = accRewardPerToken, slot 4 = commission, slot 5 = unclaimedRewards
 *   getDelegator(uint64, address): slot 2 = pending unclaimed (totalRewards)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STAKING = "0x0000000000000000000000000000000000001000";
const GET_VALIDATOR = "2b6d639a";
const GET_DELEGATOR = "573c1ce0";
const EPOCH_LEN = BigInt(50_000);
const RPC =
  process.env.MONAD_RPC_URL || "https://rpc.monad.xyz";

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function encUint64(n: bigint): string {
  return n.toString(16).padStart(64, "0");
}

function encAddr(a: string): string {
  return a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

interface RpcReq {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
}

async function rpcBatch(reqs: RpcReq[]): Promise<Array<{ id: number; result?: string; error?: { message: string } }>> {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqs),
  });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
  return r.json();
}

async function getChainHead(): Promise<bigint> {
  const r = await rpcBatch([{ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }]);
  return BigInt(r[0].result ?? "0x0");
}

export async function GET(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  const BUDGET_MS = 50_000;
  // Lookback configurable via ?lookback=N for one-shot wider sweeps after
  // freeze/outage. Default 30 epochs keeps the hourly cron lightweight.
  const url = new URL(req.url);
  const lookbackParam = Number(url.searchParams.get("lookback") ?? "30");
  const LOOKBACK_EPOCHS =
    Number.isFinite(lookbackParam) && lookbackParam >= 1 && lookbackParam <= 500
      ? Math.floor(lookbackParam)
      : 30;

  try {
    const head = await getChainHead();
    const headEpochRes = await rpcBatch([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: STAKING, data: "0x757991a8" }, "latest"],
      },
    ]);
    const headEpochHex = headEpochRes[0].result ?? "0x";
    const headEpoch = Number(BigInt("0x" + headEpochHex.slice(2, 66)));

    // Anchor from epoch_priority_fees so we can derive any epoch's start block
    const anchorRows = (await db.execute(sql`
      SELECT epoch, MIN(first_block)::text AS first_blk
        FROM epoch_priority_fees
       GROUP BY epoch
       ORDER BY epoch ASC
       LIMIT 1
    `)) as unknown as { rows: Array<{ epoch: number; first_blk: string }> };
    const anchorList = Array.isArray((anchorRows as { rows?: unknown[] }).rows)
      ? (anchorRows as { rows: Array<{ epoch: number; first_blk: string }> }).rows
      : (anchorRows as unknown as Array<{ epoch: number; first_blk: string }>);
    if (anchorList.length === 0) {
      return NextResponse.json({ ok: false, error: "no anchor" });
    }
    const anchorEpoch = BigInt(anchorList[0].epoch);
    const anchorBlock = BigInt(anchorList[0].first_blk);

    // Find missing (epoch, validator) pairs in the lookback window
    const fromEpoch = Math.max(headEpoch - LOOKBACK_EPOCHS, 1);
    const toEpoch = headEpoch - 1; // skip current in-progress

    const missingRes = (await db.execute(sql`
      WITH active_validators AS (
        SELECT validator_id, auth_address FROM validators WHERE last_epoch >= ${fromEpoch}
      ),
      target_epochs AS (
        SELECT generate_series(${fromEpoch}::int, ${toEpoch}::int) AS epoch
      )
      SELECT te.epoch, av.validator_id, av.auth_address
        FROM target_epochs te
        CROSS JOIN active_validators av
        LEFT JOIN epoch_snapshots es
               ON es.epoch = te.epoch AND es.validator_id = av.validator_id
       WHERE es.id IS NULL
       ORDER BY te.epoch DESC, av.validator_id ASC
       LIMIT 800
    `)) as unknown as { rows?: Array<{ epoch: number; validator_id: number; auth_address: string }> };
    const missing: Array<{ epoch: number; validator_id: number; auth_address: string }> = Array.isArray(
      (missingRes as { rows?: unknown[] }).rows
    )
      ? (missingRes as { rows: Array<{ epoch: number; validator_id: number; auth_address: string }> }).rows
      : (missingRes as unknown as Array<{ epoch: number; validator_id: number; auth_address: string }>);

    if (missing.length === 0) {
      return NextResponse.json({
        ok: true,
        durationMs: Date.now() - t0,
        head: head.toString(),
        headEpoch,
        gapsFound: 0,
      });
    }

    // Group by epoch so we can compute the block tag once per epoch
    const byEpoch = new Map<number, Array<{ validator_id: number; auth_address: string }>>();
    for (const m of missing) {
      const arr = byEpoch.get(m.epoch) ?? [];
      arr.push({ validator_id: m.validator_id, auth_address: m.auth_address });
      byEpoch.set(m.epoch, arr);
    }

    let inserted = 0;
    let failed = 0;

    for (const [epoch, vals] of byEpoch.entries()) {
      if (Date.now() - t0 > BUDGET_MS) break;
      const ep = BigInt(epoch);
      const blockTag = "0x" + (anchorBlock + (ep - anchorEpoch) * EPOCH_LEN + EPOCH_LEN - BigInt(10)).toString(16);

      // Build batch: getValidator + getDelegator per validator
      const reqs: RpcReq[] = [];
      vals.forEach((v, i) => {
        reqs.push({
          jsonrpc: "2.0",
          id: i * 2,
          method: "eth_call",
          params: [{ to: STAKING, data: "0x" + GET_VALIDATOR + encUint64(BigInt(v.validator_id)) }, blockTag],
        });
        reqs.push({
          jsonrpc: "2.0",
          id: i * 2 + 1,
          method: "eth_call",
          params: [
            { to: STAKING, data: "0x" + GET_DELEGATOR + encUint64(BigInt(v.validator_id)) + encAddr(v.auth_address) },
            blockTag,
          ],
        });
      });

      let resps;
      try {
        resps = await rpcBatch(reqs);
      } catch (e) {
        failed += vals.length;
        console.log(`[fill-gaps] batch err epoch ${epoch}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const byId = new Map<number, string>();
      for (const r of resps) {
        if (r.result && !r.error) byId.set(r.id, r.result);
      }

      for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        const valHex = byId.get(i * 2);
        const delHex = byId.get(i * 2 + 1);
        if (!valHex || !delHex || valHex === "0x" || delHex === "0x") {
          failed++;
          continue;
        }
        try {
          const vh = valHex.startsWith("0x") ? valHex.slice(2) : valHex;
          const slot = (n: number) => "0x" + vh.slice(n * 64, (n + 1) * 64);
          const stakeWei = BigInt(slot(2)).toString();
          const accRewardPerToken = BigInt(slot(3)).toString();
          const commission = BigInt(slot(4)).toString();
          const unclaimedRewards = BigInt(slot(5)).toString();

          const dh = delHex.startsWith("0x") ? delHex.slice(2) : delHex;
          const dslot = (n: number) => "0x" + dh.slice(n * 64, (n + 1) * 64);
          const selfStakeWei = BigInt(dslot(0)).toString();
          const authUnclaimedWei = BigInt(dslot(2)).toString();

          await db.execute(sql`
            INSERT INTO epoch_snapshots (
              epoch, validator_id, acc_reward_per_token, stake_wei, commission,
              unclaimed_rewards, self_stake_wei, auth_unclaimed_wei, created_at
            )
            VALUES (
              ${epoch}, ${v.validator_id}, ${accRewardPerToken},
              ${stakeWei}, ${commission}, ${unclaimedRewards},
              ${selfStakeWei}, ${authUnclaimedWei}, now()
            )
            ON CONFLICT (epoch, validator_id) DO NOTHING
          `);
          inserted++;
        } catch {
          failed++;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - t0,
      head: head.toString(),
      headEpoch,
      windowFromEpoch: fromEpoch,
      windowToEpoch: toEpoch,
      gapsFound: missing.length,
      epochsTouched: byEpoch.size,
      inserted,
      failed,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
