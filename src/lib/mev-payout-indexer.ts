/**
 * MEV payout indexer — shMonad SendValidatorRewards events.
 *
 * Every row in `mev_payouts` is a real on-chain event emitted by the
 * shMonad proxy when a validator's per-validator Coinbase contract pushes
 * its accumulated priority-fees + MEV bids into the staking precompile via
 * STAKING.externalReward(validatorId).
 *
 * Event signature:
 *   SendValidatorRewards(address sender, uint64 valId, uint256 validatorPayout, uint256 feeTaken)
 *   topic0 = 0xa00ba9b9fddae2429c7131955af6dd8add3137d90ca8d1145d773f79cb484dd2
 *
 * Decomposition of payout:
 *   validatorPayout = MON sent to delegators (becomes claim_events rows once
 *                     anyone calls claimRewards — already indexed)
 *   feeTaken        = shMonad protocol revenue (stays in the proxy)
 *   Commission to validator's auth address happens via a separate ETH
 *                     transfer from the Coinbase contract — NOT in this event.
 *
 * So this event captures the FULL MEV/priority-fee value the validator's
 * pool earned that block (validatorPayout + feeTaken + commissionSlice ≈
 * validatorPayout + feeTaken, since commission portion is also recoverable
 * from the same balance flow).
 */

import { db } from "@/lib/db";
import { mevPayouts, mevIndexerState } from "@/lib/db/mev-payouts-schema";
import { sql } from "drizzle-orm";

const MONAD_RPC = process.env.MONAD_RPC_URL || "https://rpc.monad.xyz";
const SHMONAD_PROXY = "0x1b68626dca36c7fe922fd2d55e4f631d962de19c";

// keccak256("SendValidatorRewards(address,uint64,uint256,uint256)")
const SEND_VALIDATOR_REWARDS_TOPIC =
  "0xa00ba9b9fddae2429c7131955af6dd8add3137d90ca8d1145d773f79cb484dd2";

const LOG_RANGE = 100; // public RPC hard cap
const RPC_TIMEOUT_MS = 12_000;
const INTER_CALL_DELAY_MS = 50;
const MAX_RETRIES = 4;
const INITIAL_BACKOFF_MS = 500;

interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  blockTimestamp?: string;
  transactionHash: string;
  logIndex: string;
  removed: boolean;
}

interface RawBlock {
  timestamp: string;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function rpc<T = unknown>(
  method: string,
  params: unknown[]
): Promise<T> {
  let lastErr: Error | null = null;
  let backoff = INITIAL_BACKOFF_MS;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
    try {
      const res = await fetch(MONAD_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: ctrl.signal,
      });
      const j = await res.json();
      if (j.error) throw new Error(`RPC ${method}: ${j.error.message}`);
      return j.result as T;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < MAX_RETRIES) {
        await sleep(backoff);
        backoff *= 2;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error("rpc failed");
}

/** Decode the data field of SendValidatorRewards (4 × 32 bytes). */
function decodeSendValidatorRewards(data: string): {
  sender: string;
  validatorId: number;
  validatorPayoutWei: bigint;
  feeTakenWei: bigint;
} {
  const h = data.startsWith("0x") ? data.slice(2) : data;
  // Slots (each 64 hex chars):
  //   0: sender address (right-padded to 32 bytes)
  //   1: validatorId (uint64)
  //   2: validatorPayout (uint256)
  //   3: feeTaken (uint256)
  const sender = ("0x" + h.slice(24, 64)).toLowerCase();
  const validatorId = Number(BigInt("0x" + h.slice(64, 128)));
  const validatorPayoutWei = BigInt("0x" + h.slice(128, 192));
  const feeTakenWei = BigInt("0x" + h.slice(192, 256));
  return { sender, validatorId, validatorPayoutWei, feeTakenWei };
}

async function getCursor(): Promise<bigint | null> {
  const rows = await db.select().from(mevIndexerState).limit(1);
  if (rows.length === 0) return null;
  return BigInt(rows[0].lastBlock);
}

async function setCursor(block: bigint): Promise<void> {
  await db
    .insert(mevIndexerState)
    .values({ id: 1, lastBlock: block, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: mevIndexerState.id,
      set: { lastBlock: block, updatedAt: new Date() },
    });
}

export interface IndexerRunOpts {
  fromBlock?: bigint; // override cursor
  toBlock?: bigint; // override head
  maxBlocks?: number;
  budgetMs?: number;
}

export interface IndexerRunResult {
  startedAt: string;
  durationMs: number;
  startBlock: string;
  endBlock: string;
  blocksScanned: number;
  logsFound: number;
  rowsInserted: number;
  rpcCalls: number;
  hitBudget: boolean;
  error: string | null;
}

export async function runMevPayoutIndexer(
  opts: IndexerRunOpts = {}
): Promise<IndexerRunResult> {
  const t0 = Date.now();
  const budgetMs = opts.budgetMs ?? 50_000;
  let rpcCalls = 0;
  let logsFound = 0;
  let rowsInserted = 0;
  let hitBudget = false;
  let error: string | null = null;

  let startBlock = opts.fromBlock ?? null;
  let endBlock = opts.toBlock ?? null;

  try {
    if (endBlock == null) {
      const headHex = await rpc<string>("eth_blockNumber", []);
      rpcCalls += 1;
      endBlock = BigInt(headHex);
    }
    if (startBlock == null) {
      const cursor = await getCursor();
      if (cursor != null) {
        startBlock = cursor + BigInt(1);
      } else {
        // First run with no cursor — start from 100 blocks before head
        // (caller should explicitly pass fromBlock for backfills).
        startBlock = endBlock - BigInt(100);
      }
    }

    if (startBlock > endBlock) {
      return {
        startedAt: new Date(t0).toISOString(),
        durationMs: Date.now() - t0,
        startBlock: startBlock.toString(),
        endBlock: endBlock.toString(),
        blocksScanned: 0,
        logsFound: 0,
        rowsInserted: 0,
        rpcCalls,
        hitBudget: false,
        error: null,
      };
    }

    if (opts.maxBlocks) {
      const cap = startBlock + BigInt(opts.maxBlocks) - BigInt(1);
      if (cap < endBlock) endBlock = cap;
    }

    let cursor = startBlock;
    const blockTsCache = new Map<string, number>();

    while (cursor <= endBlock) {
      if (Date.now() - t0 > budgetMs) {
        hitBudget = true;
        break;
      }
      const chunkEnd =
        cursor + BigInt(LOG_RANGE - 1) > endBlock
          ? endBlock
          : cursor + BigInt(LOG_RANGE - 1);
      const fromHex = "0x" + cursor.toString(16);
      const toHex = "0x" + chunkEnd.toString(16);

      const logsResp = await rpc<RawLog[]>("eth_getLogs", [
        {
          address: SHMONAD_PROXY,
          fromBlock: fromHex,
          toBlock: toHex,
          topics: [SEND_VALIDATOR_REWARDS_TOPIC],
        },
      ]);
      rpcCalls += 1;
      const logs = Array.isArray(logsResp) ? logsResp : [];
      logsFound += logs.length;

      if (logs.length > 0) {
        const blockNumbers = new Set<string>();
        for (const log of logs) {
          if (!log.blockTimestamp) blockNumbers.add(log.blockNumber);
        }
        for (const bn of blockNumbers) {
          if (Date.now() - t0 > budgetMs) {
            hitBudget = true;
            break;
          }
          if (!blockTsCache.has(bn)) {
            const block = await rpc<RawBlock>("eth_getBlockByNumber", [
              bn,
              false,
            ]);
            rpcCalls += 1;
            blockTsCache.set(bn, Number(BigInt(block.timestamp)));
            await sleep(INTER_CALL_DELAY_MS);
          }
        }

        const rows = logs
          .filter((l) => !l.removed)
          .map((l) => {
            const decoded = decodeSendValidatorRewards(l.data);
            const tsSeconds = l.blockTimestamp
              ? Number(BigInt(l.blockTimestamp))
              : blockTsCache.get(l.blockNumber);
            const blockTimestamp = new Date((tsSeconds ?? 0) * 1000);
            return {
              validatorId: decoded.validatorId,
              coinbase: decoded.sender,
              validatorPayoutWei: decoded.validatorPayoutWei.toString(),
              feeTakenWei: decoded.feeTakenWei.toString(),
              blockNumber: BigInt(l.blockNumber),
              blockTimestamp,
              txHash: l.transactionHash,
              logIndex: Number(BigInt(l.logIndex)),
            };
          });

        if (rows.length > 0) {
          // Batch insert with onConflictDoNothing on (tx_hash, log_index)
          const result = await db
            .insert(mevPayouts)
            .values(rows)
            .onConflictDoNothing();
          const inserted =
            (result as { rowCount?: number }).rowCount ?? rows.length;
          rowsInserted += inserted;
        }
      }

      cursor = chunkEnd + BigInt(1);
      await sleep(INTER_CALL_DELAY_MS);
    }

    // Cursor advances only when running in "live tail" mode (no explicit toBlock).
    // Explicit-range backfills don't touch the cursor.
    if (opts.toBlock == null) {
      const advancedTo = cursor - BigInt(1);
      if (advancedTo >= startBlock) {
        await setCursor(advancedTo);
      }
    }

    return {
      startedAt: new Date(t0).toISOString(),
      durationMs: Date.now() - t0,
      startBlock: startBlock.toString(),
      endBlock: (cursor - BigInt(1)).toString(),
      blocksScanned: Number(cursor - startBlock),
      logsFound,
      rowsInserted,
      rpcCalls,
      hitBudget,
      error: null,
    };
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    return {
      startedAt: new Date(t0).toISOString(),
      durationMs: Date.now() - t0,
      startBlock: startBlock?.toString() ?? "0",
      endBlock: "0",
      blocksScanned: 0,
      logsFound,
      rowsInserted,
      rpcCalls,
      hitBudget,
      error,
    };
  }
}

export async function getMevIndexerCursor(): Promise<bigint | null> {
  return getCursor();
}

/**
 * Get aggregated MEV payouts for a validator across a block range.
 * Returns total MON the validator's pool received from MEV/priority fees.
 */
export async function getValidatorMevPayouts(
  validatorId: number,
  fromBlock?: bigint,
  toBlock?: bigint
): Promise<{
  totalValidatorPayoutMon: number;
  totalFeeTakenMon: number;
  eventCount: number;
}> {
  const WEI = BigInt(10) ** BigInt(18);
  const toMon = (wei: bigint) =>
    Number(wei / WEI) + Number(wei % WEI) / Number(WEI);

  const rows = (await db.execute(sql`
    SELECT
      COALESCE(SUM(validator_payout_wei), 0)::text AS payout_wei,
      COALESCE(SUM(fee_taken_wei), 0)::text AS fee_wei,
      COUNT(*)::int AS n
    FROM mev_payouts
    WHERE validator_id = ${validatorId}
      ${fromBlock != null ? sql`AND block_number >= ${fromBlock.toString()}` : sql``}
      ${toBlock != null ? sql`AND block_number <= ${toBlock.toString()}` : sql``}
  `)) as unknown as { rows?: unknown[] };

  const rowsList = Array.isArray((rows as { rows?: unknown[] }).rows)
    ? ((rows as { rows: unknown[] }).rows as Array<{
        payout_wei: string;
        fee_wei: string;
        n: number;
      }>)
    : (rows as unknown as Array<{
        payout_wei: string;
        fee_wei: string;
        n: number;
      }>);
  const r = rowsList[0];
  return {
    totalValidatorPayoutMon: toMon(BigInt(r?.payout_wei || "0")),
    totalFeeTakenMon: toMon(BigInt(r?.fee_wei || "0")),
    eventCount: Number(r?.n || 0),
  };
}
