/**
 * Historical claim event backfill using Chainstack archive RPC.
 *
 * Walks blocks from 0 → existing_min in chunks. On Archive errors, falls
 * back to smaller chunks; on persistent errors at small chunks, logs the
 * gap and skips. Progress is persisted via the underlying claim_events
 * table (idempotent on tx_hash, log_index).
 *
 * Usage:
 *   START_BLOCK=50000000 END_BLOCK=65076132 \
 *     DATABASE_URL=... node scripts/historical-claim-backfill.mjs
 */
import { neon } from '@neondatabase/serverless';

const RPC = process.env.CHAINSTACK_RPC ||
  'https://rpc.monad.xyz';
const STAKING = '0x0000000000000000000000000000000000001000';
const TOPIC = '0xcb607e6b63c89c95f6ae24ece9fe0e38a7971aa5ed956254f1df47490921727b';
const PRIMARY_CHUNK = 5000;
const FALLBACK_CHUNK = 500;
const RPC_DELAY_MS = 50;

const sql = neon(process.env.DATABASE_URL);

async function rpc(method, params, retries = 3) {
  let lastErr = null;
  let backoff = 300;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const j = await res.json();
      if (j.error) {
        const msg = j.error.message || '';
        if (msg.includes('Archive error') || msg.includes('Block requested not found')) {
          // Don't retry archive errors — they're consistent
          throw new Error('ARCHIVE_GAP');
        }
        throw new Error(msg);
      }
      return j.result;
    } catch (e) {
      lastErr = e;
      if (e.message === 'ARCHIVE_GAP') throw e;
      if (i < retries) {
        await new Promise(r => setTimeout(r, backoff));
        backoff *= 2;
      }
    }
  }
  throw lastErr;
}

function topicToValidatorId(topic) { return Number(BigInt(topic)); }
function topicToAddress(topic) { return ('0x' + topic.slice(-40)).toLowerCase(); }
function decodeAmountAndEpoch(data) {
  const h = data.startsWith('0x') ? data.slice(2) : data;
  return {
    amountWei: BigInt('0x' + h.slice(0, 64)),
    epoch: Number(BigInt('0x' + h.slice(64, 128))),
  };
}

async function fetchLogsRange(from, to) {
  const fromHex = '0x' + from.toString(16);
  const toHex = '0x' + to.toString(16);
  return rpc('eth_getLogs', [{
    address: STAKING, fromBlock: fromHex, toBlock: toHex, topics: [TOPIC],
  }]);
}

async function insertLogs(logs, blockTsCache) {
  if (!Array.isArray(logs) || logs.length === 0) return 0;
  // Get block timestamps for any logs that don't include them
  const need = new Set();
  for (const log of logs) {
    if (!log.blockTimestamp) need.add(log.blockNumber);
  }
  for (const bn of need) {
    if (!blockTsCache.has(bn)) {
      const blk = await rpc('eth_getBlockByNumber', [bn, false]);
      blockTsCache.set(bn, Number(BigInt(blk.timestamp)));
      await new Promise(r => setTimeout(r, RPC_DELAY_MS));
    }
  }
  // Build rows array
  const rows = [];
  for (const l of logs) {
    if (l.removed || !l.topics || l.topics.length < 3) continue;
    const tsSeconds = l.blockTimestamp
      ? Number(BigInt(l.blockTimestamp))
      : blockTsCache.get(l.blockNumber);
    const { amountWei, epoch } = decodeAmountAndEpoch(l.data);
    rows.push({
      validator_id: topicToValidatorId(l.topics[1]),
      delegator: topicToAddress(l.topics[2]),
      amount_wei: amountWei.toString(),
      epoch,
      block_number: BigInt(l.blockNumber).toString(),
      block_timestamp: new Date((tsSeconds ?? 0) * 1000).toISOString(),
      tx_hash: l.transactionHash,
      log_index: Number(BigInt(l.logIndex)),
    });
  }
  if (rows.length === 0) return 0;
  // Batched multi-VALUES insert. Build the SQL manually since neon's
  // tagged-template doesn't natively expand arrays of rows.
  const valuesSql = rows
    .map((r, i) => {
      const o = i * 8;
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8})`;
    })
    .join(', ');
  const params = [];
  for (const r of rows) {
    params.push(
      r.validator_id, r.delegator, r.amount_wei, r.epoch,
      r.block_number, r.block_timestamp, r.tx_hash, r.log_index,
    );
  }
  const stmt = `INSERT INTO claim_events
    (validator_id, delegator, amount_wei, epoch, block_number, block_timestamp, tx_hash, log_index)
    VALUES ${valuesSql}
    ON CONFLICT (tx_hash, log_index) DO NOTHING`;
  try {
    await sql(stmt, params);
    return rows.length;
  } catch (e) {
    console.error(`  batch insert err (${rows.length} rows):`, e.message);
    return 0;
  }
}

async function processChunk(start, end, blockTsCache) {
  // Try primary chunk size first
  try {
    const logs = await fetchLogsRange(start, end);
    return { ok: true, logs };
  } catch (e) {
    if (e.message !== 'ARCHIVE_GAP') throw e;
  }
  // Fall back to smaller subchunks
  const allLogs = [];
  let gaps = 0;
  for (let s = start; s <= end; s += FALLBACK_CHUNK) {
    const e = Math.min(s + FALLBACK_CHUNK - 1, end);
    try {
      const logs = await fetchLogsRange(s, e);
      if (Array.isArray(logs)) allLogs.push(...logs);
    } catch (err) {
      if (err.message === 'ARCHIVE_GAP') {
        gaps += 1;
      } else {
        throw err;
      }
    }
    await new Promise(r => setTimeout(r, RPC_DELAY_MS));
  }
  return { ok: gaps === 0, logs: allLogs, gaps };
}

async function main() {
  const startBlock = Number(process.env.START_BLOCK || '50000000');
  const endBlock = Number(process.env.END_BLOCK || '65076132');
  console.log(`backfilling blocks ${startBlock} → ${endBlock}`);

  let cursor = startBlock;
  let totalEvents = 0;
  let totalInserted = 0;
  let totalGaps = 0;
  const blockTsCache = new Map();
  const t0 = Date.now();

  while (cursor <= endBlock) {
    const chunkEnd = Math.min(cursor + PRIMARY_CHUNK - 1, endBlock);
    let result;
    try {
      result = await processChunk(cursor, chunkEnd, blockTsCache);
    } catch (e) {
      console.error(`  chunk ${cursor}-${chunkEnd}: FATAL ${e.message}`);
      cursor = chunkEnd + 1;
      continue;
    }
    if (result.logs.length > 0) {
      const inserted = await insertLogs(result.logs, blockTsCache);
      totalEvents += result.logs.length;
      totalInserted += inserted;
    }
    if (result.gaps) totalGaps += result.gaps;
    if (result.logs.length > 0 || (cursor - startBlock) % 100000 < PRIMARY_CHUNK) {
      const pct = ((cursor - startBlock) / (endBlock - startBlock) * 100).toFixed(1);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`  ${cursor}-${chunkEnd} (${pct}%): +${result.logs.length} events, total ${totalEvents} (${totalInserted} inserted), gaps ${totalGaps}, ${elapsed}s`);
    }
    cursor = chunkEnd + 1;
    await new Promise(r => setTimeout(r, RPC_DELAY_MS));
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\nDONE in ${elapsed}s: ${totalEvents} events found, ${totalInserted} inserted, ${totalGaps} archive gaps`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
