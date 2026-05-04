/**
 * Claim event indexer.
 *
 * Source of truth for "income received" — every row in claim_events is a real
 * on-chain ClaimRewards transaction emitted by the staking precompile at
 * 0x0000000000000000000000000000000000001000.
 *
 * Event signature:
 *   ClaimRewards(uint64 indexed validatorId, address indexed delegator,
 *                uint256 amount, uint64 epoch)
 *   topic0 = 0xcb607e6b63c89c95f6ae24ece9fe0e38a7971aa5ed956254f1df47490921727b
 *
 * For commission income tracking, the relevant rows are those where
 * `delegator == validator.auth_address` — that's the validator paying
 * themselves their accumulated commission. Delegator claims from third
 * parties are also indexed (same table) but excluded from validator
 * commission totals.
 *
 * The Monad public RPC limits eth_getLogs to a 100-block range. We chunk
 * accordingly and persist a cursor in `claim_indexer_state` so successive
 * runs resume cleanly.
 */

import { db } from "@/lib/db";
import { claimEvents, claimIndexerState } from "@/lib/db/claim-events-schema";
import { sql } from "drizzle-orm";

const MONAD_RPC = process.env.MONAD_RPC_URL || "https://rpc.monad.xyz";
const STAKING_CONTRACT = "0x0000000000000000000000000000000000001000";

// keccak256("ClaimRewards(uint64,address,uint256,uint64)")
const CLAIM_REWARDS_TOPIC =
  "0xcb607e6b63c89c95f6ae24ece9fe0e38a7971aa5ed956254f1df47490921727b";

const LOG_RANGE = 100; // public RPC hard cap
const RPC_TIMEOUT_MS = 12_000;
const INTER_CALL_DELAY_MS = 50; // ~20 req/sec — under the 25 req/sec limit
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

function topicToValidatorId(topic: string): number {
  return Number(BigInt(topic));
}

function topicToAddress(topic: string): string {
  // 32-byte topic, address is the last 20 bytes
  return ("0x" + topic.slice(-40)).toLowerCase();
}

function decodeAmountAndEpoch(data: string): {
  amountWei: bigint;
  epoch: number;
} {
  // data = 0x + 64 hex (uint256 amount) + 64 hex (uint64 epoch padded to 32B)
  const h = data.startsWith("0x") ? data.slice(2) : data;
  const amountWei = BigInt("0x" + h.slice(0, 64));
  const epoch = Number(BigInt("0x" + h.slice(64, 128)));
  return { amountWei, epoch };
}

export interface IndexRunOpts {
  fromBlock?: bigint; // override cursor
  toBlock?: bigint; // override head
  budgetMs?: number; // wall-clock cap
  maxBlocks?: number; // cap blocks-scanned per run
}

export interface IndexRunResult {
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

async function getCursor(): Promise<bigint | null> {
  const rows = await db.select().from(claimIndexerState).limit(1);
  if (rows.length === 0) return null;
  return BigInt(rows[0].lastBlock);
}

async function setCursor(block: bigint): Promise<void> {
  await db.execute(sql`
    INSERT INTO claim_indexer_state (id, last_block, updated_at)
    VALUES (1, ${block.toString()}, now())
    ON CONFLICT (id) DO UPDATE SET
      last_block = EXCLUDED.last_block,
      updated_at = now()
  `);
}

/**
 * Fetch + insert ClaimRewards logs over a block range. Idempotent —
 * conflicts on (tx_hash, log_index) are ignored.
 */
export async function indexClaimEvents(
  opts: IndexRunOpts = {}
): Promise<IndexRunResult> {
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
        // First run with no cursor — start from a sensible recent point
        // (defaults to 100 blocks before head; caller should explicitly
        // provide fromBlock for backfills).
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

      const logs = await rpc<RawLog[]>("eth_getLogs", [
        {
          address: STAKING_CONTRACT,
          fromBlock: fromHex,
          toBlock: toHex,
          topics: [CLAIM_REWARDS_TOPIC],
        },
      ]);
      rpcCalls += 1;
      logsFound += logs.length;

      if (logs.length > 0) {
        // Group blocks we need timestamps for
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
          .filter((l) => !l.removed && l.topics.length >= 3)
          .map((l) => {
            const validatorId = topicToValidatorId(l.topics[1]);
            const delegator = topicToAddress(l.topics[2]);
            const { amountWei, epoch } = decodeAmountAndEpoch(l.data);
            const tsSeconds = l.blockTimestamp
              ? Number(BigInt(l.blockTimestamp))
              : blockTsCache.get(l.blockNumber);
            const blockTimestamp = new Date((tsSeconds ?? 0) * 1000);
            return {
              validatorId,
              delegator,
              amountWei: amountWei.toString(),
              epoch,
              blockNumber: BigInt(l.blockNumber),
              blockTimestamp,
              txHash: l.transactionHash,
              logIndex: Number(BigInt(l.logIndex)),
            };
          });

        if (rows.length > 0) {
          // ON CONFLICT DO NOTHING via raw SQL (Drizzle's onConflictDoNothing
          // works but we want explicit count of inserted).
          // Insert in chunks of 500 to keep payloads small.
          const CHUNK = 500;
          for (let i = 0; i < rows.length; i += CHUNK) {
            const slice = rows.slice(i, i + CHUNK);
            const result = await db
              .insert(claimEvents)
              .values(slice)
              .onConflictDoNothing();
            rowsInserted +=
              (result as { rowCount?: number }).rowCount ?? slice.length;
          }
        }
      }

      cursor = chunkEnd + BigInt(1);
      await sleep(INTER_CALL_DELAY_MS);
    }

    // Cursor advance — to wherever we actually got to.
    const advancedTo = cursor - BigInt(1);
    if (advancedTo >= startBlock) {
      await setCursor(advancedTo);
    }

    return {
      startedAt: new Date(t0).toISOString(),
      durationMs: Date.now() - t0,
      startBlock: startBlock.toString(),
      endBlock: advancedTo.toString(),
      blocksScanned: Number(advancedTo - startBlock + BigInt(1)),
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
      endBlock: endBlock?.toString() ?? "0",
      blocksScanned: 0,
      logsFound,
      rowsInserted,
      rpcCalls,
      hitBudget,
      error,
    };
  }
}
