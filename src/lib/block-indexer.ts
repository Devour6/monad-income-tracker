/**
 * Block-level priority fee indexer for Monad.
 *
 * Walks Monad blocks forward from the cursor, attributes priority fees
 * to the proposing validator, and aggregates per-(epoch, validator).
 *
 * Math:
 *   priorityFee(tx) = gasUsed(tx) * (effectiveGasPrice(tx) - baseFeePerGas(block))
 *
 * Monad runs a fixed 100 gwei baseFee (verified across hundreds of blocks),
 * but we read it from each block to stay correct if that ever changes.
 *
 * System tx 0 (gasUsed=0, effectiveGasPrice=0) is filtered. The block's
 * `miner` field is the proposing validator's authAddress.
 */

import { db } from "@/lib/db";
import { indexerState } from "@/lib/db/schema";
import { sql, eq } from "drizzle-orm";
import { resolveUnmappedMiners } from "@/lib/miner-resolver";

const MONAD_RPC = process.env.MONAD_RPC_URL || "https://rpc.monad.xyz";
const STAKING_CONTRACT = "0x0000000000000000000000000000000000001000";
const GET_EPOCH_SELECTOR = "0x757991a8";

// Tunables — JSON-RPC batching is happy at 20 receipt calls (~3s).
// Going higher risks timeouts on free RPC; lower wastes round trips.
const BLOCK_BATCH = 20;
// Hard wall-clock budget per indexer run, in ms. The endpoint must finish
// well before Vercel's 60s function timeout (or 10s on hobby) — leaving
// 5s of headroom keeps us safe.
const RUN_BUDGET_MS = 50_000;
// Epoch lookups via eth_call with block tag — we cache per-block-bucket
// so we don't re-call for every block in the same epoch.
const EPOCH_LOOKUP_INTERVAL = 5_000; // blocks
// Public RPC fronts QuickNode at 25 req/sec. We pace ourselves below that
// so retries are rare. Each iteration of the loop issues 2 batch requests
// (blocks + receipts in parallel) plus occasional epoch lookups; sleeping
// 100ms between iterations holds us at ~20 batch req/sec — safely under cap.
const INTER_BATCH_DELAY_MS = 100;
// On 429, exponential backoff up to this many retries.
const MAX_RPC_RETRIES = 4;
const INITIAL_BACKOFF_MS = 500;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Low-level RPC
// ---------------------------------------------------------------------------

interface RpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params: unknown[];
}

interface RpcResponse<T> {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: { code: number; message: string };
}

async function rpcBatch<T>(
  requests: RpcRequest[],
  timeoutMs = 30_000
): Promise<Map<number | string, T>> {
  if (requests.length === 0) return new Map();

  let attempt = 0;
  let backoff = INITIAL_BACKOFF_MS;
  while (true) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(MONAD_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requests),
        signal: ctrl.signal,
      });
      if (res.status === 429 || res.status === 503) {
        if (attempt >= MAX_RPC_RETRIES) {
          throw new Error(`RPC HTTP ${res.status} after ${attempt} retries`);
        }
        await sleep(backoff);
        backoff *= 2;
        attempt++;
        continue;
      }
      if (!res.ok) {
        throw new Error(`RPC HTTP ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as RpcResponse<T>[];
      const out = new Map<number | string, T>();
      for (const r of data) {
        if (r.result !== undefined) out.set(r.id, r.result);
      }
      return out;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Block + receipt fetching
// ---------------------------------------------------------------------------

interface RawBlock {
  number: string;
  miner: string;
  baseFeePerGas?: string;
  transactions: string[]; // hashes when fullTx=false
  timestamp: string;
  gasUsed: string;
}

interface RawReceipt {
  blockNumber: string;
  transactionHash: string;
  gasUsed: string;
  effectiveGasPrice: string;
}

async function getLatestBlockNumber(): Promise<bigint> {
  const out = await rpcBatch<string>([
    { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
  ]);
  return BigInt(out.get(1) ?? "0x0");
}

async function fetchBlocks(blockNumbers: bigint[]): Promise<Map<bigint, RawBlock>> {
  const requests: RpcRequest[] = blockNumbers.map((n, i) => ({
    jsonrpc: "2.0",
    id: i,
    method: "eth_getBlockByNumber",
    params: ["0x" + n.toString(16), false],
  }));
  const results = await rpcBatch<RawBlock>(requests);
  const out = new Map<bigint, RawBlock>();
  for (let i = 0; i < blockNumbers.length; i++) {
    const r = results.get(i);
    if (r) out.set(blockNumbers[i], r);
  }
  return out;
}

async function fetchBlockReceipts(
  blockNumbers: bigint[]
): Promise<Map<bigint, RawReceipt[]>> {
  const requests: RpcRequest[] = blockNumbers.map((n, i) => ({
    jsonrpc: "2.0",
    id: i,
    method: "eth_getBlockReceipts",
    params: ["0x" + n.toString(16)],
  }));
  const results = await rpcBatch<RawReceipt[]>(requests);
  const out = new Map<bigint, RawReceipt[]>();
  for (let i = 0; i < blockNumbers.length; i++) {
    const r = results.get(i);
    if (r) out.set(blockNumbers[i], r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Epoch lookup (cached)
// ---------------------------------------------------------------------------

// Deterministic epoch anchor: epoch 1413 starts at block 70,622,155.
// Every epoch is exactly 50,000 blocks. This lets us derive epoch from
// block number without an eth_call at the historical block tag — critical
// when the block is below Chainstack's archive state floor (state queries
// fail, but block headers + receipts still work for eth_getBlockByNumber /
// eth_getBlockReceipts).
const EPOCH_ANCHOR_BLOCK = BigInt(70_622_155);
const EPOCH_ANCHOR_EPOCH = 1413;
const BLOCKS_PER_EPOCH_BIG = BigInt(50_000);

function deriveEpochFromBlock(blockNumber: bigint): number {
  // epoch = floor((blk - anchorBlk) / 50000) + anchorEpoch
  const delta = blockNumber - EPOCH_ANCHOR_BLOCK;
  // BigInt floor-division handles negative blocks too (Node's BigInt /
  // truncates toward zero; for our purposes anchor is always older).
  return Number(delta / BLOCKS_PER_EPOCH_BIG) + EPOCH_ANCHOR_EPOCH;
}

class EpochLookup {
  private cache = new Map<bigint, number>(); // bucket → epoch

  async getEpochAtBlock(blockNumber: bigint): Promise<number> {
    const bucket = blockNumber - (blockNumber % BigInt(EPOCH_LOOKUP_INTERVAL));
    const cached = this.cache.get(bucket);
    if (cached !== undefined) return cached;

    // Try the precompile first — it's the source of truth for the current
    // chain state and handles any future epoch-length changes correctly.
    try {
      const out = await rpcBatch<string>([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [
            { to: STAKING_CONTRACT, data: GET_EPOCH_SELECTOR },
            "0x" + blockNumber.toString(16),
          ],
        },
      ]);
      const hex = (out.get(1) ?? "0x").slice(2);
      if (hex.length >= 64) {
        const epoch = Number(BigInt("0x" + hex.slice(0, 64)));
        this.cache.set(bucket, epoch);
        return epoch;
      }
    } catch {
      // Fall through to deterministic derivation.
    }

    // Fallback: block is below Chainstack's archive state floor (or RPC
    // returned an unexpected response). Use the deterministic anchor —
    // epoch boundaries are at fixed 50,000-block intervals.
    const epoch = deriveEpochFromBlock(blockNumber);
    this.cache.set(bucket, epoch);
    return epoch;
  }
}

// ---------------------------------------------------------------------------
// Core attribution
// ---------------------------------------------------------------------------

function priorityFeesForBlock(
  block: RawBlock,
  receipts: RawReceipt[]
): bigint {
  const baseFee = BigInt(block.baseFeePerGas ?? "0x0");
  let total = BigInt(0);
  for (const r of receipts) {
    const gasUsed = BigInt(r.gasUsed);
    const effGas = BigInt(r.effectiveGasPrice);
    if (gasUsed === BigInt(0) || effGas === BigInt(0)) continue; // system tx
    const tip = effGas - baseFee;
    if (tip <= BigInt(0)) continue;
    total += gasUsed * tip;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Persistence — upsert per-(epoch, validator) row
// ---------------------------------------------------------------------------

interface AggKey {
  epoch: number;
  minerAddress: string;
}

function keyOf(k: AggKey): string {
  return `${k.epoch}:${k.minerAddress}`;
}

interface AggValue {
  priorityFeesWei: bigint;
  blocksProposed: number;
  firstBlock: bigint;
  lastBlock: bigint;
}

async function flushAggregates(agg: Map<string, AggValue & AggKey>) {
  if (agg.size === 0) return;
  // Additive upsert on priority_fees_wei + blocks_proposed; min/max on
  // first_block/last_block. Done one-row-at-a-time for simplicity — the
  // run budget will only ever flush ~25 unique miners per call so this
  // isn't a hot path.
  for (const v of agg.values()) {
    await db.execute(sql`
      INSERT INTO epoch_priority_fees
        (epoch, miner_address, priority_fees_wei, blocks_proposed, first_block, last_block, updated_at)
      VALUES (${v.epoch}, ${v.minerAddress}, ${v.priorityFeesWei.toString()}, ${v.blocksProposed}, ${v.firstBlock}, ${v.lastBlock}, NOW())
      ON CONFLICT (epoch, miner_address) DO UPDATE SET
        priority_fees_wei = (CAST(epoch_priority_fees.priority_fees_wei AS NUMERIC) + CAST(EXCLUDED.priority_fees_wei AS NUMERIC))::TEXT,
        blocks_proposed   = epoch_priority_fees.blocks_proposed + EXCLUDED.blocks_proposed,
        first_block       = LEAST(epoch_priority_fees.first_block, EXCLUDED.first_block),
        last_block        = GREATEST(epoch_priority_fees.last_block, EXCLUDED.last_block),
        updated_at        = NOW()
    `);
  }
}

async function getCursor(): Promise<{ lastBlock: bigint } | null> {
  const rows = await db.select().from(indexerState).limit(1);
  if (rows.length === 0) return null;
  return { lastBlock: BigInt(rows[0].lastBlock) };
}

async function setCursor(lastBlock: bigint, lastEpoch: number) {
  const existing = await db.select({ id: indexerState.id }).from(indexerState).limit(1);
  if (existing.length === 0) {
    await db.insert(indexerState).values({ lastBlock, lastEpoch });
  } else {
    await db
      .update(indexerState)
      .set({ lastBlock, lastEpoch, updatedAt: new Date() })
      .where(eq(indexerState.id, existing[0].id));
  }
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export interface IndexerRunResult {
  startBlock: bigint;
  endBlock: bigint;
  blocksProcessed: number;
  blocksAttributed: number;
  totalPriorityFeesWei: string;
  epochsTouched: number[];
  minersTouched: number;
  minersResolved: number;
  durationMs: number;
}

/**
 * Run the indexer forward from the persisted cursor, until either:
 *   - we reach the chain head, or
 *   - we hit RUN_BUDGET_MS.
 *
 * Optional `seedBlock` lets the caller bootstrap (e.g. start from
 * `head - 50_000`) the very first time.
 *
 * `range` overrides the cursor entirely — the indexer walks the explicit
 * [from, to] block range without touching the persisted cursor. Used for
 * historical backfills (e.g. epochs older than the live cursor's start).
 */
export async function runIndexer(opts: {
  seedBlock?: bigint;
  maxBlocks?: number;
  range?: { from: bigint; to: bigint };
} = {}): Promise<IndexerRunResult> {
  const t0 = Date.now();
  const head = await getLatestBlockNumber();

  let cursor: { lastBlock: bigint } | null;
  if (opts.range) {
    cursor = { lastBlock: opts.range.from - BigInt(1) };
  } else {
    cursor = await getCursor();
    if (!cursor) {
      const seed = opts.seedBlock ?? head - BigInt(50_000);
      cursor = { lastBlock: seed };
    }
  }

  const startBlock = cursor.lastBlock + BigInt(1);
  if (!opts.range && startBlock > head) {
    return {
      startBlock,
      endBlock: cursor.lastBlock,
      blocksProcessed: 0,
      blocksAttributed: 0,
      totalPriorityFeesWei: "0",
      epochsTouched: [],
      minersTouched: 0,
      minersResolved: 0,
      durationMs: Date.now() - t0,
    };
  }

  const epochLookup = new EpochLookup();
  const agg = new Map<string, AggValue & AggKey>();

  let current = startBlock;
  const upperLimit = opts.range ? opts.range.to : head;
  const targetEnd = opts.maxBlocks
    ? startBlock + BigInt(opts.maxBlocks) - BigInt(1)
    : upperLimit;
  const endBoundary = targetEnd < upperLimit ? targetEnd : upperLimit;

  let blocksAttributed = 0;
  let totalFees = BigInt(0);
  const epochsTouched = new Set<number>();
  const minersTouched = new Set<string>();

  while (current <= endBoundary) {
    if (Date.now() - t0 > RUN_BUDGET_MS) break;

    const batchSize = Number(
      endBoundary - current + BigInt(1) > BigInt(BLOCK_BATCH)
        ? BigInt(BLOCK_BATCH)
        : endBoundary - current + BigInt(1)
    );
    const nums: bigint[] = [];
    for (let i = 0; i < batchSize; i++) nums.push(current + BigInt(i));

    // Sequential (not parallel) — public RPC counts each batch request
    // separately for rate-limit purposes, so spacing avoids 429s.
    const blocks = await fetchBlocks(nums);
    await sleep(INTER_BATCH_DELAY_MS);
    const receiptsMap = await fetchBlockReceipts(nums);
    await sleep(INTER_BATCH_DELAY_MS);

    for (const n of nums) {
      const block = blocks.get(n);
      const receipts = receiptsMap.get(n);
      if (!block || !receipts) continue;

      const fees = priorityFeesForBlock(block, receipts);
      const minerAddress = block.miner.toLowerCase();

      const epoch = await epochLookup.getEpochAtBlock(n);
      epochsTouched.add(epoch);
      minersTouched.add(minerAddress);

      const k: AggKey = { epoch, minerAddress };
      const ks = keyOf(k);
      const existing = agg.get(ks);
      if (existing) {
        existing.priorityFeesWei += fees;
        existing.blocksProposed += 1;
        if (n < existing.firstBlock) existing.firstBlock = n;
        if (n > existing.lastBlock) existing.lastBlock = n;
      } else {
        agg.set(ks, {
          ...k,
          priorityFeesWei: fees,
          blocksProposed: 1,
          firstBlock: n,
          lastBlock: n,
        });
      }
      blocksAttributed++;
      totalFees += fees;
    }

    current += BigInt(batchSize);
  }

  // Flush + advance cursor (cursor untouched in range mode — we don't want
  // a backfill walk to clobber the realtime cursor).
  if (agg.size > 0) await flushAggregates(agg);
  const lastProcessed = current - BigInt(1);
  if (!opts.range && lastProcessed >= startBlock) {
    const lastEpoch = epochsTouched.size > 0 ? Math.max(...epochsTouched) : 0;
    await setCursor(lastProcessed, lastEpoch);
  }

  // Auto-resolve any new miners we just saw — most distributor contracts
  // map cleanly via storage slot 0. Bounded to remaining time budget so we
  // never push the run over its wall-clock cap.
  let minersResolved = 0;
  if (Date.now() - t0 < RUN_BUDGET_MS) {
    try {
      const r = await resolveUnmappedMiners();
      minersResolved = r.resolved;
    } catch {
      // resolver failures are non-fatal — fees are still indexed by miner_address
    }
  }

  return {
    startBlock,
    endBlock: lastProcessed,
    blocksProcessed: Number(lastProcessed - startBlock + BigInt(1)),
    blocksAttributed,
    totalPriorityFeesWei: totalFees.toString(),
    epochsTouched: [...epochsTouched].sort((a, b) => a - b),
    minersTouched: minersTouched.size,
    minersResolved,
    durationMs: Date.now() - t0,
  };
}
