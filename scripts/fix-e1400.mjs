/**
 * The auth_unclaimed at epoch 1400 looks wrong (7,270 then jumps to 53,524 at 1401).
 * Most likely the live snapshot cron stored 1400 with a stale value before my
 * historical backfill ran. Re-fetch at deterministic block and re-write.
 *
 * Also fix any other epochs <= 1416 where the same pattern might appear.
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const RPC = "https://monad-mainnet.core.chainstack.com/e645e5ea23a58c7671b3847d83020297";
const STAKING = "0x0000000000000000000000000000000000001000";
const GET_DELEGATOR = "0x573c1ce0";

const ANCHOR_EPOCH = 1485;
const ANCHOR_BLOCK = 74_205_000;
const EPOCH_LEN = 50_000;
const MIDPOINT_OFFSET = 25_000;

function encUint64(n) { return n.toString(16).padStart(64, "0"); }
function encAddr(a) { return a.replace(/^0x/, "").toLowerCase().padStart(64, "0"); }
function epochToBlock(e) {
  return ANCHOR_BLOCK + (e - ANCHOR_EPOCH) * EPOCH_LEN + MIDPOINT_OFFSET;
}

async function rpcBatch(calls) {
  const body = calls.map((c, i) => ({
    jsonrpc: "2.0", id: i, method: "eth_call",
    params: [{ to: STAKING, data: c.data }, "0x" + BigInt(c.block).toString(16)],
  }));
  const r = await fetch(RPC, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  const out = new Map();
  for (const row of j) {
    if (row.result && row.result !== "0x") out.set(row.id, row.result);
  }
  return out;
}

function decodeDelegator(hex) {
  const h = hex.replace(/^0x/, "");
  return BigInt("0x" + h.slice(2 * 64, 3 * 64));
}

const fromEpoch = parseInt(process.env.FROM_EPOCH || "1400");
const toEpoch = parseInt(process.env.TO_EPOCH || "1400");

const validators = await sql`
  SELECT validator_id, auth_address FROM validators WHERE auth_address IS NOT NULL ORDER BY validator_id
`;
console.log(`re-fetching auth_unclaimed for ${validators.length} validators, epochs ${fromEpoch}-${toEpoch}`);

let updated = 0, failed = 0;

for (let e = fromEpoch; e <= toEpoch; e++) {
  const block = epochToBlock(e);
  console.log(`epoch ${e} → block ${block}`);

  const BATCH = 50;
  for (let i = 0; i < validators.length; i += BATCH) {
    const chunk = validators.slice(i, i + BATCH);
    const calls = chunk.map((v) => ({
      data: GET_DELEGATOR + encUint64(BigInt(v.validator_id)) + encAddr(v.auth_address),
      block,
    }));
    try {
      const res = await rpcBatch(calls);
      for (let j = 0; j < chunk.length; j++) {
        const hex = res.get(j);
        if (!hex) { failed++; continue; }
        try {
          const pending = decodeDelegator(hex);
          await sql`
            UPDATE epoch_snapshots
            SET auth_unclaimed_wei = ${pending.toString()}
            WHERE validator_id = ${chunk[j].validator_id} AND epoch = ${e}
          `;
          updated++;
        } catch (err) { failed++; }
      }
    } catch (err) {
      console.log(`  batch ${i} failed: ${err.message}`);
      failed += chunk.length;
    }
    await new Promise(r => setTimeout(r, 50));
  }
}

console.log(`DONE — updated=${updated} failed=${failed}`);
