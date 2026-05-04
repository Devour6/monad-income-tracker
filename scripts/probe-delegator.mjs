import { neon } from '@neondatabase/serverless';

const RPC = 'https://rpc.monad.xyz';
const STAKING = '0x0000000000000000000000000000000000001000';
const GET_DELEGATOR = '0x573c1ce0';
const validatorId = 200n;
const addr = '0x02004d41bdb94497d34cd603767e71d3127a6285';

function pad32(hex) {
  hex = hex.replace(/^0x/, '');
  return hex.padStart(64, '0');
}
const data = GET_DELEGATOR + pad32(validatorId.toString(16)) + pad32(addr.slice(2));

const res = await fetch(RPC, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'eth_call',
    params: [{ to: STAKING, data }, 'latest'],
  }),
});
const j = await res.json();
console.log('raw:', j.result);
if (j.result && j.result !== '0x') {
  const hex = j.result.replace(/^0x/, '');
  const stakeWei = BigInt('0x' + hex.slice(0, 64));
  const unclaimedWei = BigInt('0x' + hex.slice(64, 128));
  console.log('  stake:', (Number(stakeWei / 10n ** 16n) / 100).toFixed(2), 'MON');
  console.log('  unclaimed:', (Number(unclaimedWei / 10n ** 16n) / 100).toFixed(2), 'MON');
}
