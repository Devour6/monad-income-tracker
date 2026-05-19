import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  SELECT epoch, stake_wei, acc_reward_per_token, commission, auth_unclaimed_wei
  FROM epoch_snapshots
  WHERE validator_id = 200 AND epoch >= 1495
  ORDER BY epoch ASC
`;
const WEI = 10n ** 18n;
const ACC = 10n ** 36n;
console.log("Phase Stake recent epochs:");
let prevAcc = null, prevStake = null, prevAuth = null;
for (const r of rows) {
  const stakeWei = BigInt(r.stake_wei);
  const acc = BigInt(r.acc_reward_per_token);
  const auth = r.auth_unclaimed_wei ? BigInt(r.auth_unclaimed_wei) : null;
  const commPct = Number(BigInt(r.commission)) / 1e16;
  const stakeMon = Number(stakeWei / WEI);
  const authMon = auth !== null ? Number(auth) / 1e18 : null;
  let poolEarned = null;
  if (prevAcc !== null && prevStake !== null && acc > prevAcc) {
    const reward = (acc - prevAcc) * prevStake / ACC;
    poolEarned = Number(reward) / 1e18;
  }
  const authDelta = (auth !== null && prevAuth !== null) ? (Number(auth) - Number(prevAuth)) / 1e18 : null;
  console.log(`  e${r.epoch} stake=${stakeMon} comm=${commPct.toFixed(2)}% acc_digits=${acc.toString().length} auth=${authMon !== null ? authMon.toFixed(2) : "NULL"} poolEarned=${poolEarned !== null ? poolEarned.toFixed(2) : "—"} authDelta=${authDelta !== null ? authDelta.toFixed(2) : "—"}`);
  prevAcc = acc; prevStake = stakeWei; prevAuth = auth;
}
