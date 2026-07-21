// Re-read epoch_snapshots.auth_unclaimed_wei at DETERMINISTIC block heights.
//
// Why: the live snapshot cron fires every 15 min on wall-clock, samples
// getDelegator(valId, auth) at "current block", and stamps the result as
// belonging to whatever epoch getEpoch() returns. That means within a single
// epoch (5.5 hours / ~22 cron runs) we keep overwriting the row with samples
// taken at different points in the epoch's lifetime. Adjacent epochs end up
// with non-monotonic auth_unclaimed values, producing phantom "no income"
// gaps in the chart even though the on-chain accrual is smooth.
//
// Fix: re-read every closed epoch's auth_unclaimed at a canonical block
// (epoch_end - 10 blocks) so every row reads "what the precompile said the
// auth was owed at the moment that epoch closed." Idempotent.
//
// Skips the current in-progress epoch (we can't yet read its post-close
// state). The next cron run after the epoch closes can be run again to
// stamp the canonical value.
//
// Usage:
//   DATABASE_URL=... MONAD_RPC=... \
//     FROM_EPOCH=1460 TO_EPOCH=1500 \
//     node scripts/reread-auth-unclaimed-deterministic.mjs
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const RPC =
  process.env.MONAD_RPC ||
  "https://rpc.monad.xyz";

const STAKING = "0x0000000000000000000000000000000000001000";
const GET_DELEGATOR = "573c1ce0";
const GET_EPOCH_SELECTOR = "0x757991a8";
const EPOCH_LEN = 50000n;
const EPOCH_END_MARGIN = 10n; // sample at epoch_end - 10 blocks (post-finalization)

function encodeUint64(n) {
  return BigInt(n).toString(16).padStart(64, "0");
}
function encodeAddress(addr) {
  return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}
function buildCalldata(valId, auth) {
  return "0x" + GET_DELEGATOR + encodeUint64(valId) + encodeAddress(auth);
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

async function rpcSingle(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return j.result;
}

const FROM_EPOCH = process.env.FROM_EPOCH ? Number(process.env.FROM_EPOCH) : null;
const TO_EPOCH = process.env.TO_EPOCH ? Number(process.env.TO_EPOCH) : null;
if (FROM_EPOCH == null || TO_EPOCH == null) {
  console.error("Set FROM_EPOCH and TO_EPOCH env vars");
  process.exit(1);
}

// Current chain head + epoch — skip in-progress epoch.
const headHex = await rpcSingle("eth_blockNumber", []);
const headBlock = BigInt(headHex);
const currentEpochHex = await rpcSingle("eth_call", [
  { to: STAKING, data: GET_EPOCH_SELECTOR },
  "0x" + headBlock.toString(16),
]);
const currentEpoch = Number(BigInt("0x" + currentEpochHex.slice(2, 66)));
console.log(`chain head=${headBlock} currentEpoch=${currentEpoch}`);
console.log(`re-read window: epochs ${FROM_EPOCH}-${TO_EPOCH} (skipping current epoch ${currentEpoch})`);

// Anchor: any (epoch, first_block) pair from epoch_priority_fees.
const anchorRow = await sql`
  SELECT epoch, MIN(first_block)::text AS first_blk
    FROM epoch_priority_fees
   GROUP BY epoch
   ORDER BY epoch ASC
   LIMIT 1
`;
if (anchorRow.length === 0) {
  console.error("no epoch_priority_fees data to anchor epoch boundaries");
  process.exit(1);
}
const anchorEpoch = BigInt(anchorRow[0].epoch);
const anchorBlock = BigInt(anchorRow[0].first_blk);
console.log(`anchor: epoch ${anchorEpoch} starts at block ${anchorBlock}`);

const epochs = await sql`
  SELECT DISTINCT epoch
    FROM epoch_snapshots
   WHERE epoch BETWEEN ${FROM_EPOCH} AND ${TO_EPOCH}
   ORDER BY epoch ASC
`;
console.log(`${epochs.length} epochs in range`);

const validators = await sql`SELECT validator_id, auth_address FROM validators`;
const validatorList = validators.map((v) => ({
  validator_id: v.validator_id,
  auth_address: v.auth_address,
}));
console.log(`${validatorList.length} validators per epoch`);

let totalUpdated = 0;
let totalFailed = 0;
let totalSkipped = 0;

for (const { epoch } of epochs) {
  // Skip in-progress epoch — its post-close state doesn't exist yet.
  if (epoch >= currentEpoch) {
    totalSkipped += validatorList.length;
    console.log(`skip epoch ${epoch} (in-progress / future)`);
    continue;
  }

  const ep = BigInt(epoch);
  // Canonical sample point: epoch_end - 10 blocks. Epoch N ends at
  // (anchorBlock + (N - anchorEpoch + 1) * EPOCH_LEN - 1). We subtract a
  // small margin to avoid any boundary-block edge cases on the precompile.
  const epochEnd = anchorBlock + (ep - anchorEpoch + 1n) * EPOCH_LEN - 1n;
  const sampleBlock = epochEnd - EPOCH_END_MARGIN;

  // Sanity: don't try to query above chain head.
  if (sampleBlock > headBlock) {
    totalSkipped += validatorList.length;
    console.log(`skip epoch ${epoch} (sampleBlock ${sampleBlock} > head ${headBlock})`);
    continue;
  }

  console.log(`\n=== epoch ${epoch} → block ${sampleBlock} (epoch_end - 10) ===`);

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
        "0x" + sampleBlock.toString(16),
      ],
    }));
    let resps;
    try {
      resps = await rpcBatch(reqs);
    } catch (e) {
      console.log(`  batch err: ${e.message}`);
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
        // OVERWRITE — this is the canonical reading. Replace whatever the
        // live cron stamped at a random mid-epoch moment.
        await sql`
          UPDATE epoch_snapshots
             SET auth_unclaimed_wei = ${wei}
           WHERE epoch = ${epoch}
             AND validator_id = ${v.validator_id}
        `;
        updated++;
      } catch {
        failed++;
      }
    }
  }
  totalUpdated += updated;
  totalFailed += failed;
  console.log(`  updated=${updated} failed=${failed}`);
}

console.log(
  `\nDONE — updated=${totalUpdated} failed=${totalFailed} skipped=${totalSkipped}`
);
