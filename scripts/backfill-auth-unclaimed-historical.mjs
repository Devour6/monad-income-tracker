// Historical backfill of epoch_snapshots.auth_unclaimed_wei by calling
// getDelegator(valId, auth) at the START BLOCK of each target epoch.
//
// Epoch boundaries on Monad are deterministic: 50,000 blocks per epoch.
// Anchor: epoch_priority_fees.first_block tells us the start block of
// any known epoch. Every other epoch's start = anchor + (epoch - anchor) * 50000.
// Way faster + correct (no buggy timestamp binary search).
//
// Usage:
//   DATABASE_URL=... MONAD_RPC=... \
//     FROM_EPOCH=1400 TO_EPOCH=1462 \
//     node scripts/backfill-auth-unclaimed-historical.mjs
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
const EPOCH_LEN = 50000n;

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

const FROM_EPOCH = process.env.FROM_EPOCH ? Number(process.env.FROM_EPOCH) : null;
const TO_EPOCH = process.env.TO_EPOCH ? Number(process.env.TO_EPOCH) : null;
if (FROM_EPOCH == null || TO_EPOCH == null) {
  console.error("Set FROM_EPOCH and TO_EPOCH env vars");
  process.exit(1);
}

console.log(`backfill: epochs ${FROM_EPOCH}-${TO_EPOCH}`);

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

const epochsNeeded = await sql`
  SELECT DISTINCT epoch
    FROM epoch_snapshots
   WHERE epoch BETWEEN ${FROM_EPOCH} AND ${TO_EPOCH}
     AND auth_unclaimed_wei IS NULL
   ORDER BY epoch ASC
`;
console.log(`${epochsNeeded.length} epochs need fill`);

const validators = await sql`SELECT validator_id, auth_address FROM validators`;
const validatorList = validators.map((v) => ({
  validator_id: v.validator_id,
  auth_address: v.auth_address,
}));
console.log(`${validatorList.length} validators per epoch`);

for (const { epoch } of epochsNeeded) {
  const ep = BigInt(epoch);
  // Use mid-epoch block (start + 25000) for state queries — avoids any
  // boundary-block edge cases.
  const midBlock = anchorBlock + (ep - anchorEpoch) * EPOCH_LEN + EPOCH_LEN / 2n;
  console.log(`\n=== epoch ${epoch} → block ${midBlock} ===`);

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
        "0x" + midBlock.toString(16),
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
        await sql`
          UPDATE epoch_snapshots
             SET auth_unclaimed_wei = ${wei}
           WHERE epoch = ${epoch}
             AND validator_id = ${v.validator_id}
             AND auth_unclaimed_wei IS NULL
        `;
        updated++;
      } catch {
        failed++;
      }
    }
  }
  console.log(`  updated=${updated} failed=${failed}`);
}

console.log("\nDONE");
