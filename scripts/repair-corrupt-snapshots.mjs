// Repair epoch_snapshots rows where stake_wei/acc_reward_per_token/commission
// were stored with wrong slot indices (the original backfill script had a bug:
// it used slot 2 for commission, 3 for stake, 4 for acc — should be 4/2/3).
//
// Identifies corrupt rows by LENGTH(stake_wei) > 30 (real stake is 26-27 digits,
// corrupt rows have the accumulator value there which is 33-35 digits).
//
// Re-fetches getValidator() at (epoch_end - 10) and overwrites with correct slots.

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
const GET_VALIDATOR = "2b6d639a";
const EPOCH_LEN = 50000n;

function encodeUint64(n) {
  return BigInt(n).toString(16).padStart(64, "0");
}
function buildCalldata(valId) {
  return "0x" + GET_VALIDATOR + encodeUint64(valId);
}
async function rpcBatch(reqs, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqs),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

// Anchor for epoch -> block conversion.
const anchorRow = await sql`
  SELECT epoch, MIN(first_block)::text AS first_blk
    FROM epoch_priority_fees
   GROUP BY epoch ORDER BY epoch ASC LIMIT 1
`;
if (anchorRow.length === 0) {
  console.error("no anchor available");
  process.exit(1);
}
const anchorEpoch = BigInt(anchorRow[0].epoch);
const anchorBlock = BigInt(anchorRow[0].first_blk);
console.log(`anchor: epoch ${anchorEpoch} starts at block ${anchorBlock}`);

// Find corrupt epochs (stake_wei stored as 31+ digit accumulator value).
const corruptEpochs = await sql`
  SELECT DISTINCT epoch FROM epoch_snapshots
   WHERE LENGTH(stake_wei) > 30
   ORDER BY epoch
`;
console.log(`${corruptEpochs.length} epochs have corrupt rows`);

for (const { epoch } of corruptEpochs) {
  const ep = BigInt(epoch);
  const blk = anchorBlock + (ep - anchorEpoch) * EPOCH_LEN + EPOCH_LEN - 10n;
  console.log(`\n=== epoch ${epoch} → block ${blk} ===`);

  // Get the validators with corrupt rows for this epoch
  const corruptVids = await sql`
    SELECT validator_id FROM epoch_snapshots
     WHERE epoch = ${epoch} AND LENGTH(stake_wei) > 30
     ORDER BY validator_id
  `;
  console.log(`  ${corruptVids.length} corrupt rows to repair`);

  const BATCH = 50;
  let updated = 0;
  let failed = 0;
  for (let i = 0; i < corruptVids.length; i += BATCH) {
    const slice = corruptVids.slice(i, i + BATCH);
    const reqs = slice.map((v, j) => ({
      jsonrpc: "2.0",
      id: j,
      method: "eth_call",
      params: [{ to: STAKING, data: buildCalldata(v.validator_id) }, "0x" + blk.toString(16)],
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
      const h = resp.result.startsWith("0x") ? resp.result.slice(2) : resp.result;
      if (h.length < 384) {
        failed++;
        continue;
      }
      const sl = (i) => h.slice(i * 64, (i + 1) * 64);
      const stakeWei = BigInt("0x" + sl(2));
      const accRewardPerToken = BigInt("0x" + sl(3));
      const commission = BigInt("0x" + sl(4));
      const unclaimedRewards = BigInt("0x" + sl(5));
      try {
        await sql`
          UPDATE epoch_snapshots
             SET stake_wei = ${stakeWei.toString()},
                 acc_reward_per_token = ${accRewardPerToken.toString()},
                 commission = ${commission.toString()},
                 unclaimed_rewards = ${unclaimedRewards.toString()}
           WHERE epoch = ${epoch}
             AND validator_id = ${v.validator_id}
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
