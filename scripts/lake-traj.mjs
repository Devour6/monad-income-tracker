import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);

// LakeStake auth = 0x1d2c7ab8...
const claims = await sql`
  SELECT epoch, block_number, amount_wei::numeric / 1e18 AS mon
  FROM claim_events
  WHERE validator_id = 37
    AND delegator = '0x1d2c7ab8bcfcc62a8bac73500240d13297197a49'
  ORDER BY epoch
`;
console.log("LakeStake auth claims:");
for (const c of claims) console.log("  e" + c.epoch, "blk=" + c.block_number, "mon=" + Number(c.mon).toFixed(2));

const rows = await sql`
  SELECT epoch, auth_unclaimed_wei::numeric / 1e18 AS auth_mon
  FROM epoch_snapshots
  WHERE validator_id = 37 AND epoch BETWEEN 1380 AND 1495
  ORDER BY epoch
`;
console.log("\nAll snapshot rows 1380-1495:");
let prev = null;
let badCount = 0;
for (const r of rows) {
  const cur = Number(r.auth_mon);
  const delta = prev != null ? cur - prev : null;
  const flag = delta != null && delta < 0 ? " ⚠ NEG" : "";
  if (delta != null && delta < 0) badCount++;
  console.log(
    "e" + r.epoch,
    "auth=" + cur.toFixed(2).padStart(10),
    "delta=" + (delta != null ? delta.toFixed(2).padStart(10) : "      NULL"),
    flag
  );
  prev = cur;
}
console.log("\nnegative-delta count:", badCount);
