const MONAD_RPC = "https://rpc.monad.xyz";
const STAKING_CONTRACT = "0x0000000000000000000000000000000000001000";
const GET_VALIDATOR = "0x2b6d639a";

async function getCommission(id) {
  const data = GET_VALIDATOR + id.toString(16).padStart(64, "0");
  const res = await fetch(MONAD_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", params: [{ to: STAKING_CONTRACT, data }, "latest"], id: 1 })
  });
  const json = await res.json();
  if (!json.result || json.result === "0x") return null;
  const hex = json.result.slice(2);
  const slot = (n) => BigInt("0x" + hex.slice(n * 64, (n + 1) * 64));
  return {
    id,
    commissionRaw: slot(4).toString(),
    consensusCommissionRaw: slot(7).toString(),
    stakeMON: (slot(2) / BigInt(10n**18n)).toString()
  };
}

const ids = [200, 1, 2, 5, 10, 20, 50, 100, 150];
for (const id of ids) {
  const r = await getCommission(id);
  if (r) {
    console.log(`Validator ${r.id}: commission=${r.commissionRaw}, consensusComm=${r.consensusCommissionRaw}, stake=${r.stakeMON} MON`);
  }
}
