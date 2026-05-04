import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

const r = await sql`
  SELECT epoch, stake_wei, self_stake_wei, unclaimed_rewards
  FROM epoch_snapshots WHERE validator_id = 200
  ORDER BY epoch DESC LIMIT 3
`;
for (const s of r) {
  const stake = Number(BigInt(s.stake_wei) / 10n ** 16n) / 100;
  const self = s.self_stake_wei ? Number(BigInt(s.self_stake_wei) / 10n ** 16n) / 100 : null;
  const unclaimed = Number(BigInt(s.unclaimed_rewards) / 10n ** 16n) / 100;
  const share = self && stake ? self / stake : null;
  console.log('epoch', s.epoch, 'stake:', stake, 'self:', self, 'unclaimed:', unclaimed.toFixed(2), 'self share:', share ? (share * 100).toFixed(4) + '%' : 'n/a');
  if (share != null) console.log('  est validator share of unclaimed:', (unclaimed * share).toFixed(2), 'MON');
}
