import { NextResponse } from "next/server";
import {
  DEFAULT_MON_PRICE,
  DEFAULT_TOTAL_STAKED,
  DEFAULT_ACTIVE_VALIDATORS,
} from "@/lib/constants";

export const revalidate = 300; // ISR: revalidate every 5 minutes

const MONAD_RPC = "https://rpc.monad.xyz";
const STAKING_CONTRACT = "0x0000000000000000000000000000000000001000";

// Function selectors from Monad staking contract
const GET_CONSENSUS_VALIDATOR_SET = "0xfb29b729"; // getConsensusValidatorSet(uint32)
const GET_VALIDATOR = "0x2b6d639a"; // getValidator(uint64)

/** Encode a uint32 as 32-byte hex (right-padded in ABI encoding) */
function encodeUint32(n: number): string {
  return n.toString(16).padStart(64, "0");
}

/** Encode a uint64 as 32-byte hex */
function encodeUint64(n: bigint): string {
  return n.toString(16).padStart(64, "0");
}

/** Make an eth_call to the Monad staking contract */
async function ethCall(data: string): Promise<string> {
  const res = await fetch(MONAD_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: STAKING_CONTRACT, data }, "latest"],
      id: 1,
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

/**
 * Fetch all active validator IDs from the consensus set.
 * Paginates through getConsensusValidatorSet(uint32 startIndex)
 * Returns: (bool isDone, uint32 nextIndex, uint64[] valIds)
 */
async function fetchActiveValidatorIds(): Promise<bigint[]> {
  const allIds: bigint[] = [];
  let startIndex = 0;
  let isDone = false;

  while (!isDone) {
    const data = GET_CONSENSUS_VALIDATOR_SET + encodeUint32(startIndex);
    const result = await ethCall(data);

    // Decode ABI response:
    // offset 0: bool isDone (32 bytes)
    // offset 32: uint32 nextIndex (32 bytes)
    // offset 64: offset to dynamic array (32 bytes)
    // offset 96+: array length (32 bytes) then uint64[] elements
    const hex = result.slice(2); // remove 0x

    isDone = BigInt("0x" + hex.slice(0, 64)) !== BigInt(0);
    startIndex = Number(BigInt("0x" + hex.slice(64, 128)));

    // Dynamic array: offset is at position 128 (3rd slot)
    const arrayOffset = Number(BigInt("0x" + hex.slice(128, 192))) * 2; // byte offset to char offset
    const arrayLen = Number(BigInt("0x" + hex.slice(arrayOffset, arrayOffset + 64)));

    for (let i = 0; i < arrayLen; i++) {
      const start = arrayOffset + 64 + i * 64;
      const valId = BigInt("0x" + hex.slice(start, start + 64));
      allIds.push(valId);
    }
  }

  return allIds;
}

/**
 * Fetch live network staking data from the Monad staking contract.
 * Uses batch RPC calls for efficiency.
 */
async function fetchNetworkStakingData(): Promise<{
  networkStake: number;
  activeValidators: number;
}> {
  // Step 1: Get all active validator IDs
  const valIds = await fetchActiveValidatorIds();

  // Step 2: Batch-fetch validator stakes
  const batchCalls = valIds.map((valId, i) => ({
    jsonrpc: "2.0" as const,
    method: "eth_call",
    params: [
      { to: STAKING_CONTRACT, data: GET_VALIDATOR + encodeUint64(valId) },
      "latest",
    ],
    id: i + 1,
  }));

  // Monad RPC batch limit is 100, split if needed
  let totalStake = BigInt(0);
  for (let i = 0; i < batchCalls.length; i += 100) {
    const batch = batchCalls.slice(i, i + 100);
    const res = await fetch(MONAD_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    const results: Array<{ result?: string; error?: { message: string } }> =
      await res.json();

    for (const r of results) {
      if (r.result) {
        const hex = r.result.slice(2);
        // stake is the 3rd field (index 2) → offset 128 chars
        const stakeWei = BigInt("0x" + hex.slice(128, 192));
        totalStake += stakeWei;
      }
    }
  }

  return {
    networkStake: Number(totalStake / BigInt(10) ** BigInt(18)),
    activeValidators: valIds.length,
  };
}

export async function GET() {
  const defaults = {
    monPrice: DEFAULT_MON_PRICE,
    networkStake: DEFAULT_TOTAL_STAKED,
    activeValidators: DEFAULT_ACTIVE_VALIDATORS,
    updatedAt: null,
  };

  try {
    // Fetch MON price and network staking data in parallel
    const [priceResult, stakingResult] = await Promise.allSettled([
      fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd",
        { next: { revalidate: 300 } }
      ).then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        const raw = data?.monad?.usd;
        return typeof raw === "number" && isFinite(raw) && raw > 0
          ? raw
          : null;
      }),
      fetchNetworkStakingData(),
    ]);

    const monPrice =
      priceResult.status === "fulfilled" && priceResult.value !== null
        ? priceResult.value
        : defaults.monPrice;

    const networkStake =
      stakingResult.status === "fulfilled"
        ? stakingResult.value.networkStake
        : defaults.networkStake;

    const activeValidators =
      stakingResult.status === "fulfilled"
        ? stakingResult.value.activeValidators
        : defaults.activeValidators;

    return NextResponse.json({
      monPrice,
      networkStake,
      activeValidators,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(
      "Live data fetch error:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(defaults);
  }
}
