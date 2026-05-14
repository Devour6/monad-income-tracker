// One-off backfill: populate epoch_snapshots.auth_unclaimed_wei for every
// validator on the most recent epoch via getDelegator(valId, authAddr).slot[2].
//
// Why: snapshot cron will start capturing this going forward, but the report
// endpoint needs at least one filled row to compute meaningful Δ. This script
// gives the most recent epoch a value for every validator so the dashboard
// shows the correct "earned since claim" number immediately.
//
// Usage:
//   DATABASE_URL=... MONAD_RPC=... node scripts/backfill-auth-unclaimed.mjs
//
// Optional: EPOCH=<n> to target a specific epoch instead of the latest.
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
  return GET_DELEGATOR + encodeUint64(valId) + encodeAddress(auth);
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

const targetEpoch = process.env.EPOCH
  ? Number(process.env.EPOCH)
  : (await sql`SELECT MAX(epoch) AS e FROM epoch_snapshots`)[0].e;

console.log(`backfilling auth_unclaimed_wei for epoch ${targetEpoch}`);

const rows = await sql`
  SELECT s.validator_id, v.auth_address
    FROM epoch_snapshots s
    JOIN validators v ON v.validator_id = s.validator_id
   WHERE s.epoch = ${targetEpoch}
     AND s.auth_unclaimed_wei IS NULL
`;

console.log(`${rows.length} validators need auth_unclaimed at epoch ${targetEpoch}`);

if (rows.length === 0) {
  console.log("nothing to do");
  process.exit(0);
}

let updated = 0;
let failed = 0;
const BATCH = 50;
for (let i = 0; i < rows.length; i += BATCH) {
  const slice = rows.slice(i, i + BATCH);
  const reqs = slice.map((r, j) => ({
    jsonrpc: "2.0",
    id: j,
    method: "eth_call",
    params: [
      { to: STAKING, data: "0x" + buildCalldata(r.validator_id, r.auth_address) },
      "latest",
    ],
  }));
  const responses = await rpcBatch(reqs);
  for (const resp of responses) {
    const r = slice[resp.id];
    if (resp.error || !resp.result || resp.result === "0x") {
      failed++;
      continue;
    }
    const h = resp.result.startsWith("0x") ? resp.result.slice(2) : resp.result;
    if (h.length < 192) {
      failed++;
      continue;
    }
    // slot 2 = totalRewards = pending claimable
    const slot2Hex = h.slice(128, 192);
    const wei = BigInt("0x" + slot2Hex).toString();
    await sql`
      UPDATE epoch_snapshots
         SET auth_unclaimed_wei = ${wei}
       WHERE epoch = ${targetEpoch}
         AND validator_id = ${r.validator_id}
    `;
    updated++;
  }
  console.log(
    `[${(((i + slice.length) / rows.length) * 100).toFixed(0)}%] updated=${updated} failed=${failed}`
  );
  // ease off the RPC a bit
  await new Promise((res) => setTimeout(res, 100));
}

console.log(`DONE — updated=${updated} failed=${failed}`);
