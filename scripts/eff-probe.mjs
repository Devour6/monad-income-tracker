import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

const epoch = 1421;
const fees = await sql`
  SELECT pf.miner_address, pf.blocks_proposed::int as blocks_proposed,
         ma.validator_id, v.name, v.stake_mon
  FROM epoch_priority_fees pf
  LEFT JOIN miner_aliases ma ON ma.miner_address = pf.miner_address
  LEFT JOIN validators v ON v.validator_id = ma.validator_id
  WHERE pf.epoch = ${epoch}
  ORDER BY pf.blocks_proposed DESC
  LIMIT 15`;

const totalStakeRow = await sql`SELECT sum(stake_mon::numeric)::text as total FROM validators`;
const totalStake = Number(totalStakeRow[0].total);
const totalBlocksRow = await sql`SELECT sum(blocks_proposed)::int as t FROM epoch_priority_fees WHERE epoch = ${epoch}`;
const epochBlocks = totalBlocksRow[0].t;

console.log(`epoch ${epoch} totalBlocks: ${epochBlocks} totalStake: ${totalStake.toFixed(0)}`);
console.log();
for (const r of fees) {
  if (!r.stake_mon) {
    console.log('UNMAPPED ' + r.miner_address.slice(0, 10) + ' blocks: ' + r.blocks_proposed);
    continue;
  }
  const stake = Number(r.stake_mon);
  const expected = epochBlocks * (stake / totalStake);
  const eff = r.blocks_proposed / expected;
  console.log(
    (r.name || 'vid=' + r.validator_id).padEnd(20),
    'actual:', String(r.blocks_proposed).padStart(4),
    'expected:', expected.toFixed(0).padStart(4),
    'eff:', eff.toFixed(2)
  );
}
