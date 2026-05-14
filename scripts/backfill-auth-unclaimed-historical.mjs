// Historical backfill of epoch_snapshots.auth_unclaimed_wei across multiple
// epochs by calling getDelegator(valId, auth) at the block tag closest to
// each snapshot's wall-clock time.
//
// Approach:
//   1. Map each snapshot's created_at → block_number via timestamp search
//      (binary search using eth_getBlockByNumber).
//   2. Batch eth_call at that historical block tag for every validator.
//   3. Decode slot 2 (totalRewards = pending) and write to DB.
//
// Usage:
//   DATABASE_URL=... MONAD_RPC=... \
//     FROM_EPOCH=1460 TO_EPOCH=1491 \
//     node scripts/backfill-auth-unclaimed-historical.mjs
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const RPC =
  process.env.MONAD_RPC ||
  "https://monad-mainnet.core.chainstack.com/e645e5ea23a58c7671b3847d83020297";

const STAKING = "0x0000000000000000000000000000000000001000";
const GET_DELEGATOR = "573c1ce0";

function encodeUint64(n) {
  return BigInt(n).toString(16).padStart(64, "0");
}
function encodeAddress(addr) {
  return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}
function buildCalldata(valId, auth) {
  return "0x" + GET_DELEGATOR + encodeUint64(valId) + encodeAddress(auth);
}

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(method + ": " + j.error.message);
  return j.result;
}

async function rpcBatch(reqs) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqs),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function getBlockTimestamp(blk) {
  const b = await rpc("eth_getBlockByNumber", ["0x" + blk.toString(16), false]);
  return b ? Number(BigInt(b.timestamp)) * 1000 : null; // ms
}

// Find a block number whose timestamp is just <= targetMs.
async function findBlockAtTime(targetMs, lo, hi) {
  while (lo + 1n < hi) {
    const mid = (lo + hi) / 2n;
    const ts = await getBlockTimestamp(mid);
    if (ts == null) return null;
    if (ts <= targetMs) lo = mid;
    else hi = mid;
  }
  return lo;
}

const FROM_EPOCH = process.env.FROM_EPOCH ? Number(process.env.FROM_EPOCH) : null;
const TO_EPOCH = process.env.TO_EPOCH ? Number(process.env.TO_EPOCH) : null;

if (FROM_EPOCH == null || TO_EPOCH == null) {
  console.error("Set FROM_EPOCH and TO_EPOCH env vars");
  process.exit(1);
}

console.log(`historical auth_unclaimed backfill: epochs ${FROM_EPOCH}-${TO_EPOCH}`);

const head = BigInt(await rpc("eth_blockNumber", []));
console.log(`chain head: ${head}`);

// Get all snapshots needing fill in that range, oldest first (binary search
// uses prior epoch's block as low bound to speed up subsequent searches).
const epochList = await sql`
  SELECT epoch, MIN(created_at) AS first_seen
    FROM epoch_snapshots
   WHERE epoch BETWEEN ${FROM_EPOCH} AND ${TO_EPOCH}
     AND auth_unclaimed_wei IS NULL
   GROUP BY epoch
   ORDER BY epoch ASC
`;
console.log(`${epochList.length} epochs to fill`);

const validators = await sql`SELECT validator_id, auth_address FROM validators`;
const validatorList = validators.map((v) => ({
  validator_id: v.validator_id,
  auth_address: v.auth_address,
}));
console.log(`${validatorList.length} validators to query`);

let priorBlock = head - 5_000_000n; // initial lo for first binary search (5M blk back ≈ 21 days)
for (const { epoch, first_seen } of epochList) {
  const targetMs = new Date(first_seen).getTime();
  console.log(`\n=== epoch ${epoch} @ ${new Date(targetMs).toISOString()} ===`);
  const blk = await findBlockAtTime(targetMs, priorBlock, head);
  if (blk == null) {
    console.log("  could not find block, skipping");
    continue;
  }
  const blkTs = await getBlockTimestamp(blk);
  console.log(`  block=${blk} (ts=${new Date(blkTs).toISOString()})`);
  priorBlock = blk; // narrow search for next epoch (always older next? no, ASC sorted)

  // Batch eth_call at that historical block tag
  let updated = 0;
  let failed = 0;
  const BATCH = 50;
  for (let i = 0; i < validatorList.length; i += BATCH) {
    const slice = validatorList.slice(i, i + BATCH);
    const reqs = slice.map((v, j) => ({
      jsonrpc: "2.0",
      id: j,
      method: "eth_call",
      params: [
        { to: STAKING, data: buildCalldata(v.validator_id, v.auth_address) },
        "0x" + blk.toString(16),
      ],
    }));
    let resps;
    try {
      resps = await rpcBatch(reqs);
    } catch (e) {
      console.log(`  batch failed: ${e.message}`);
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
        await sql`
          UPDATE epoch_snapshots
             SET auth_unclaimed_wei = ${wei}
           WHERE epoch = ${epoch}
             AND validator_id = ${v.validator_id}
             AND auth_unclaimed_wei IS NULL
        `;
        updated++;
      } catch (e) {
        failed++;
      }
    }
  }
  console.log(`  updated=${updated} failed=${failed}`);
}

console.log("\nDONE");
