import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const WEI = 10n ** 18n;
const toMon = (w) => Number(w / WEI) + Number(w % WEI) / Number(WEI);

const rows = await sql`
  SELECT epoch, unclaimed_rewards, auth_unclaimed_wei, stake_wei
  FROM epoch_snapshots
  WHERE validator_id = 200 AND epoch BETWEEN 1400 AND 1493
  ORDER BY epoch
`;
console.log('epoch | pool_unc | auth_unc | auth_delta');
let prev = null;
for (const r of rows) {
  const au = r.auth_unclaimed_wei ? toMon(BigInt(r.auth_unclaimed_wei)) : null;
  const delta = prev != null && au != null ? au - prev : null;
  console.log(`  ${r.epoch} pool=${toMon(BigInt(r.unclaimed_rewards)).toFixed(0)} auth=${au != null ? au.toFixed(2) : 'NULL'} delta=${delta != null ? delta.toFixed(2) : 'NULL'}`);
  if (au != null) prev = au;
}
