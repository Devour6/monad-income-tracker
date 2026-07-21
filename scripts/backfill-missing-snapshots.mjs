/**
 * Backfill missing epoch_snapshots rows in a given epoch range.
 *
 * For every (epoch, validator) pair where no snapshot exists, calls
 * getValidator(id) + getDelegator(id, auth) at the deterministic block tag
 * for that epoch's midpoint, and inserts the row.
 *
 * Block formula: epoch N starts at block 50000 × (N - 1485) + 74_205_000.
 * We aim ~25K blocks into the epoch (midpoint) to ensure the precompile
 * recognizes us as inside that epoch.
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const RPC = process.env.MONAD_RPC || "https://rpc.monad.xyz";

const STAKING = "0x0000000000000000000000000000000000001000";
const GET_VALIDATOR = "0x2b6d639a";
const GET_DELEGATOR = "0x573c1ce0";
const WEI = 10n ** 18n;

const ANCHOR_EPOCH = 1485;
const ANCHOR_BLOCK = 74_205_000;
const EPOCH_LEN = 50_000;
const MIDPOINT_OFFSET = 25_000;

function encUint64(n) {
  return n.toString(16).padStart(64, "0");
}
function encAddr(a) {
  return a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

function epochToBlock(epoch) {
  return ANCHOR_BLOCK + (epoch - ANCHOR_EPOCH) * EPOCH_LEN + MIDPOINT_OFFSET;
}

async function rpcBatch(calls) {
  const body = calls.map((c, i) => ({
    jsonrpc: "2.0", id: i, method: "eth_call",
    params: [{ to: STAKING, data: c.data }, "0x" + BigInt(c.block).toString(16)],
  }));
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  const out = new Map();
  for (const row of j) {
    if (row.result && row.result !== "0x") out.set(row.id, row.result);
  }
  return out;
}

function decodeValidator(hex) {
  const h = hex.replace(/^0x/, "");
  const slot = (i) => h.slice(i * 64, (i + 1) * 64);
  return {
    authAddress: "0x" + slot(0).slice(24),
    commission: BigInt("0x" + slot(4)),
    stakeWei: BigInt("0x" + slot(2)),
    accRewardPerToken: BigInt("0x" + slot(3)),
    unclaimedRewards: BigInt("0x" + slot(5)),
  };
}

function decodeDelegator(hex) {
  const h = hex.replace(/^0x/, "");
  const slot = (i) => h.slice(i * 64, (i + 1) * 64);
  return {
    selfStakeWei: BigInt("0x" + slot(0)),
    totalRewards: BigInt("0x" + slot(2)), // auth pending
  };
}

// Get all validators we want to cover
const validatorRows = await sql`
  SELECT validator_id, auth_address
  FROM validators
  WHERE auth_address IS NOT NULL
  ORDER BY validator_id
`;
console.log(`covering ${validatorRows.length} validators`);

const fromEpoch = parseInt(process.env.FROM_EPOCH || "1440");
const toEpoch = parseInt(process.env.TO_EPOCH || "1493");

// Find which (epoch, validator) pairs are missing
const existingRows = await sql`
  SELECT epoch, validator_id FROM epoch_snapshots
  WHERE epoch BETWEEN ${fromEpoch} AND ${toEpoch}
`;
const have = new Set(existingRows.map(r => `${r.epoch}:${r.validator_id}`));

const missing = [];
for (let e = fromEpoch; e <= toEpoch; e++) {
  for (const v of validatorRows) {
    const key = `${e}:${v.validator_id}`;
    if (!have.has(key)) {
      missing.push({ epoch: e, validatorId: v.validator_id, authAddress: v.auth_address });
    }
  }
}
console.log(`missing pairs: ${missing.length} (range ${fromEpoch}-${toEpoch})`);

if (missing.length === 0) {
  console.log("nothing to do");
  process.exit(0);
}

// Group by epoch
const byEpoch = new Map();
for (const m of missing) {
  if (!byEpoch.has(m.epoch)) byEpoch.set(m.epoch, []);
  byEpoch.get(m.epoch).push(m);
}

let totalInserted = 0;
let totalFailed = 0;

for (const [epoch, items] of [...byEpoch.entries()].sort((a, b) => a[0] - b[0])) {
  const block = epochToBlock(epoch);
  console.log(`\n=== epoch ${epoch} → block ${block} (${items.length} validators) ===`);

  // Batch RPC calls (50 at a time)
  const BATCH = 50;
  const snapshots = []; // { validatorId, ...validatorData, selfStakeWei, authUnclaimedWei }

  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    // Build pairs of (getValidator, getDelegator) calls
    const calls = [];
    for (const it of chunk) {
      calls.push({ data: GET_VALIDATOR + encUint64(BigInt(it.validatorId)), block });
      calls.push({
        data: GET_DELEGATOR + encUint64(BigInt(it.validatorId)) + encAddr(it.authAddress),
        block,
      });
    }
    try {
      const results = await rpcBatch(calls);
      for (let j = 0; j < chunk.length; j++) {
        const it = chunk[j];
        const vHex = results.get(j * 2);
        const dHex = results.get(j * 2 + 1);
        if (!vHex || !dHex) { totalFailed++; continue; }
        try {
          const v = decodeValidator(vHex);
          const d = decodeDelegator(dHex);
          snapshots.push({
            validatorId: it.validatorId,
            authAddress: v.authAddress,
            commission: v.commission,
            stakeWei: v.stakeWei,
            accRewardPerToken: v.accRewardPerToken,
            unclaimedRewards: v.unclaimedRewards,
            selfStakeWei: d.selfStakeWei,
            authUnclaimedWei: d.totalRewards,
          });
        } catch (e) {
          totalFailed++;
        }
      }
    } catch (e) {
      console.log(`  RPC batch failed: ${e.message}`);
      totalFailed += chunk.length;
    }
    await new Promise(r => setTimeout(r, 50));
  }

  // Bulk insert
  for (const s of snapshots) {
    try {
      await sql`
        INSERT INTO epoch_snapshots (
          epoch, validator_id, acc_reward_per_token, stake_wei, commission,
          unclaimed_rewards, self_stake_wei, auth_unclaimed_wei, created_at
        )
        VALUES (
          ${epoch}, ${s.validatorId}, ${s.accRewardPerToken.toString()},
          ${s.stakeWei.toString()}, ${s.commission.toString()},
          ${s.unclaimedRewards.toString()}, ${s.selfStakeWei.toString()},
          ${s.authUnclaimedWei.toString()}, NOW()
        )
        ON CONFLICT (epoch, validator_id) DO NOTHING
      `;
      totalInserted++;
    } catch (e) {
      console.log(`  insert failed v${s.validatorId}: ${e.message}`);
      totalFailed++;
    }
  }
  console.log(`  inserted=${snapshots.length} (failed=${items.length - snapshots.length})`);
}

console.log(`\nDONE — inserted=${totalInserted} failed=${totalFailed}`);
