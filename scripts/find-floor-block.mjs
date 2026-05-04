import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
// Find earliest snapshot with a real timestamp -> get its block via /api/v1/indexer/status anchor
const r = await sql`SELECT MIN(epoch) as min_e, MAX(epoch) as max_e FROM epoch_snapshots`;
console.log('snap range:', r[0]);
// Approximate floor block: head - (current_epoch - min_epoch) * 50000
const headRes = await fetch('https://rpc.monad.xyz', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({jsonrpc:'2.0',method:'eth_blockNumber',params:[],id:1}),
});
const head = parseInt((await headRes.json()).result, 16);
const epochAtHead = await fetch('https://rpc.monad.xyz', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({jsonrpc:'2.0',method:'eth_call',params:[{to:'0x0000000000000000000000000000000000001000',data:'0x757991a8'},'latest'],id:1}),
});
const eHex = (await epochAtHead.json()).result;
const headEpoch = parseInt(eHex.slice(2, 66), 16);
const minE = Number(r[0].min_e);
const epochsBack = headEpoch - minE;
const floorBlock = head - epochsBack * 50000;
console.log(`head=${head} epochAtHead=${headEpoch} minSnap=${minE}`);
console.log(`floor block estimate: ${floorBlock} (${epochsBack} epochs back)`);
