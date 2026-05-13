#!/usr/bin/env node
/**
 * Local block-level priority fee backfill.
 *
 * The Vercel-hosted indexer hits Monad's public RPC and gets ~94% null
 * responses (rate-limit or geographic). From a local machine the same
 * RPC returns 100%. So we run the same indexing logic locally and write
 * directly to the prod Postgres.
 *
 * Walks a [START_BLOCK, END_BLOCK] range, batches of 20 blocks at a time
 * (matching the Vercel indexer's behavior so we share the same upsert
 * semantics on epoch_priority_fees). Idempotent — re-running over an
 * already-indexed range only nudges first_block/last_block bounds.
 *
 * Usage:
 *   START_BLOCK=73650000 END_BLOCK=74000000 node scripts/local-block-backfill.mjs
 *
 * If START_BLOCK is omitted, defaults to (current cursor - 1M).
 * If END_BLOCK is omitted, defaults to current chain head.
 */

import { neon } from "@neondatabase/serverless";

const RPC = process.env.MONAD_RPC || "https://rpc.monad.xyz";
const STAKING = "0x0000000000000000000000000000000000001000";
const GET_EPOCH_SEL = "0x757991a8";

const BATCH = 20;
const SLEEP_MS = 50;
const EPOCH_BUCKET = 5000;
const FLUSH_EVERY_BLOCKS = 5000;
const PARALLEL = 2; // run N batches concurrently

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function rpcBatch(reqs) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30_000);
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqs),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.status === 429 || res.status === 503) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const out = new Map();
      for (const r of data) {
        if (r.result !== undefined) out.set(r.id, r.result);
      }
      return out;
    } catch (e) {
      // ECONNRESET, ETIMEDOUT, abort, etc. — retry with backoff.
      if (attempt < 7) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      // Final fallback: return empty map; caller treats as missing blocks.
      console.error(`rpcBatch failed after retries: ${e.message}`);
      return new Map();
    }
  }
  return new Map();
}

async function getHead() {
  const r = await rpcBatch([
    { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
  ]);
  return BigInt(r.get(1) ?? "0x0");
}

async function fetchBlocks(nums) {
  const reqs = nums.map((n, i) => ({
    jsonrpc: "2.0",
    id: i,
    method: "eth_getBlockByNumber",
    params: ["0x" + n.toString(16), false],
  }));
  const r = await rpcBatch(reqs);
  const out = new Map();
  for (let i = 0; i < nums.length; i++) {
    const x = r.get(i);
    if (x) out.set(nums[i], x);
  }
  return out;
}

async function fetchReceipts(nums) {
  const reqs = nums.map((n, i) => ({
    jsonrpc: "2.0",
    id: i,
    method: "eth_getBlockReceipts",
    params: ["0x" + n.toString(16)],
  }));
  const r = await rpcBatch(reqs);
  const out = new Map();
  for (let i = 0; i < nums.length; i++) {
    const x = r.get(i);
    if (Array.isArray(x)) out.set(nums[i], x);
  }
  return out;
}

const epochCache = new Map();
async function epochAt(blockNum) {
  const bucket = blockNum - (blockNum % BigInt(EPOCH_BUCKET));
  if (epochCache.has(bucket)) return epochCache.get(bucket);
  const r = await rpcBatch([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [
        { to: STAKING, data: GET_EPOCH_SEL },
        "0x" + blockNum.toString(16),
      ],
    },
  ]);
  const hex = (r.get(1) ?? "0x").slice(2);
  if (hex.length < 64) throw new Error(`bad epoch at ${blockNum}`);
  const epoch = Number(BigInt("0x" + hex.slice(0, 64)));
  epochCache.set(bucket, epoch);
  return epoch;
}

function priorityFees(block, receipts) {
  const baseFee = BigInt(block.baseFeePerGas ?? "0x0");
  let total = 0n;
  for (const r of receipts) {
    const gasUsed = BigInt(r.gasUsed);
    const effGas = BigInt(r.effectiveGasPrice);
    if (gasUsed === 0n || effGas === 0n) continue;
    const tip = effGas - baseFee;
    if (tip <= 0n) continue;
    total += gasUsed * tip;
  }
  return total;
}

async function flush(agg) {
  if (agg.size === 0) return;
  for (const v of agg.values()) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await sql`
          INSERT INTO epoch_priority_fees
            (epoch, miner_address, priority_fees_wei, blocks_proposed, first_block, last_block, updated_at)
          VALUES (${v.epoch}, ${v.minerAddress}, ${v.priorityFeesWei.toString()}, ${v.blocksProposed}, ${v.firstBlock.toString()}, ${v.lastBlock.toString()}, NOW())
          ON CONFLICT (epoch, miner_address) DO UPDATE SET
            priority_fees_wei = (CAST(epoch_priority_fees.priority_fees_wei AS NUMERIC) + CAST(EXCLUDED.priority_fees_wei AS NUMERIC))::TEXT,
            blocks_proposed   = epoch_priority_fees.blocks_proposed + EXCLUDED.blocks_proposed,
            first_block       = LEAST(epoch_priority_fees.first_block, EXCLUDED.first_block),
            last_block        = GREATEST(epoch_priority_fees.last_block, EXCLUDED.last_block),
            updated_at        = NOW()
        `;
        break;
      } catch (e) {
        if (attempt < 4) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        console.error(`flush failed for ${v.epoch}:${v.minerAddress}: ${e.message}`);
      }
    }
  }
}

const head = await getHead();
const cursorRow = await sql`SELECT last_block FROM indexer_state LIMIT 1`;
const liveCursor = cursorRow[0] ? BigInt(cursorRow[0].last_block) : head;

const start = process.env.START_BLOCK
  ? BigInt(process.env.START_BLOCK)
  : liveCursor - 1_000_000n;
const end = process.env.END_BLOCK ? BigInt(process.env.END_BLOCK) : head;

console.log(
  `head=${head}  liveCursor=${liveCursor}  range=${start}..${end} (${end - start + 1n} blocks)`
);

async function processBatch(nums, agg) {
  let blocks, receipts;
  try {
    blocks = await fetchBlocks(nums);
  } catch (e) {
    return { attributed: 0, fees: 0n, err: e.message };
  }
  try {
    receipts = await fetchReceipts(nums);
  } catch (e) {
    return { attributed: 0, fees: 0n, err: e.message };
  }
  // Retry missing
  const missB = nums.filter((n) => !blocks.has(n));
  if (missB.length) {
    try {
      const r = await fetchBlocks(missB);
      for (const [k, v] of r) blocks.set(k, v);
    } catch {}
  }
  const missR = nums.filter((n) => !receipts.has(n));
  if (missR.length) {
    try {
      const r = await fetchReceipts(missR);
      for (const [k, v] of r) receipts.set(k, v);
    } catch {}
  }
  let attributed = 0;
  let totalFees = 0n;
  for (const n of nums) {
    const block = blocks.get(n);
    const recs = receipts.get(n);
    if (!block || !Array.isArray(recs)) continue;
    const fees = priorityFees(block, recs);
    const miner = block.miner.toLowerCase();
    const epoch = await epochAt(n);
    const k = `${epoch}:${miner}`;
    const existing = agg.get(k);
    if (existing) {
      existing.priorityFeesWei += fees;
      existing.blocksProposed += 1;
      if (n < existing.firstBlock) existing.firstBlock = n;
      if (n > existing.lastBlock) existing.lastBlock = n;
    } else {
      agg.set(k, {
        epoch,
        minerAddress: miner,
        priorityFeesWei: fees,
        blocksProposed: 1,
        firstBlock: n,
        lastBlock: n,
      });
    }
    attributed++;
    totalFees += fees;
  }
  return { attributed, fees: totalFees, err: null };
}

let cur = start;
let totalScanned = 0;
let totalAttributed = 0;
let totalFees = 0n;
const tStart = Date.now();
let agg = new Map();
let blocksSinceFlush = 0;

while (cur <= end) {
 try {
  // Build PARALLEL batches at once
  const batches = [];
  for (let p = 0; p < PARALLEL; p++) {
    const remaining = end - cur + 1n;
    if (remaining <= 0n) break;
    const sz = Number(remaining > BigInt(BATCH) ? BigInt(BATCH) : remaining);
    const nums = [];
    for (let i = 0; i < sz; i++) nums.push(cur + BigInt(i));
    batches.push(nums);
    cur += BigInt(sz);
  }
  if (batches.length === 0) break;

  const results = await Promise.all(batches.map((b) => processBatch(b, agg)));
  for (let i = 0; i < batches.length; i++) {
    totalScanned += batches[i].length;
    totalAttributed += results[i].attributed;
    totalFees += results[i].fees;
    blocksSinceFlush += batches[i].length;
  }

  await sleep(SLEEP_MS);

  if (blocksSinceFlush >= FLUSH_EVERY_BLOCKS) {
    await flush(agg);
    agg = new Map();
    blocksSinceFlush = 0;
    const elapsed = (Date.now() - tStart) / 1000;
    const rate = totalScanned / elapsed;
    const remain = Number(end - cur + 1n);
    const eta = remain / rate;
    const pct = ((totalScanned / Number(end - start + 1n)) * 100).toFixed(2);
    console.log(
      `[${pct}%] cur=${cur} scanned=${totalScanned} attributed=${totalAttributed} (${((totalAttributed / totalScanned) * 100).toFixed(1)}%) fees=${(Number(totalFees / 10n ** 18n) + Number(totalFees % 10n ** 18n) / 1e18).toFixed(2)} MON rate=${rate.toFixed(0)}b/s eta=${(eta / 60).toFixed(0)}min`
    );
  }
 } catch (e) {
   console.error(`outer loop err at cur=${cur}: ${e.message}`);
   await sleep(5000);
   // continue — don't crash
 }
}

await flush(agg);
console.log(
  `\nDONE in ${((Date.now() - tStart) / 1000).toFixed(0)}s scanned=${totalScanned} attributed=${totalAttributed} (${((totalAttributed / totalScanned) * 100).toFixed(1)}%) fees=${(Number(totalFees / 10n ** 18n) + Number(totalFees % 10n ** 18n) / 1e18).toFixed(2)} MON`
);
