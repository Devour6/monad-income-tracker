/**
 * Monad Staking Precompile RPC client.
 *
 * Calls the staking precompile at 0x1000 to fetch:
 * - Epoch number (getEpoch)
 * - Consensus validator set (getConsensusValidatorSet)
 * - Per-validator data including accRewardPerToken (getValidator)
 *
 * ABI-encoded return layout for getValidator (each slot = 32 bytes = 64 hex chars):
 *   Slot 0: authAddress (address)
 *   Slot 1: flags (uint64)
 *   Slot 2: stake (uint256) — total stake in wei
 *   Slot 3: accRewardPerToken (uint256) — global reward accumulator
 *   Slot 4: commission (uint256)
 *   Slot 5: unclaimedRewards (uint256)
 *   Slot 6: consensusStake (uint256)
 *   Slot 7: consensusCommission (uint256)
 *   Slot 8: snapshotStake (uint256)
 *   Slot 9: snapshotCommission (uint256)
 *   Slot 10: secpPubkey offset (pointer)
 *   Slot 11: blsPubkey offset (pointer)
 */

const MONAD_RPC = "https://rpc.monad.xyz";
const STAKING_CONTRACT = "0x0000000000000000000000000000000000001000";

// Function selectors
const GET_EPOCH = "0x757991a8";
const GET_CONSENSUS_VALIDATOR_SET = "0xfb29b729";
const GET_VALIDATOR = "0x2b6d639a";

const WEI_PER_MON = BigInt(10) ** BigInt(18);

function encodeUint32(n: number): string {
  return n.toString(16).padStart(64, "0");
}

function encodeUint64(n: bigint): string {
  return n.toString(16).padStart(64, "0");
}

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
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

async function batchEthCall(
  calls: { data: string; id: number }[]
): Promise<Map<number, string>> {
  const results = new Map<number, string>();

  // Try batch RPC first, fall back to sequential if not supported
  for (let i = 0; i < calls.length; i += 50) {
    const batch = calls.slice(i, i + 50);

    try {
      // Try JSON-RPC batch (array of requests)
      const batchPayload = batch.map((c) => ({
        jsonrpc: "2.0" as const,
        method: "eth_call",
        params: [{ to: STAKING_CONTRACT, data: c.data }, "latest"],
        id: c.id,
      }));

      const res = await fetch(MONAD_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batchPayload),
      });
      const json = await res.json();

      // If response is an array, batch RPC worked
      if (Array.isArray(json)) {
        for (const r of json) {
          if (r.result) {
            results.set(r.id, r.result);
          }
        }
        continue;
      }

      // Single object response means batch not supported — fall through to sequential
      console.log("[rpc] Batch not supported, falling back to sequential calls");
    } catch {
      console.log("[rpc] Batch call failed, falling back to sequential");
    }

    // Sequential fallback — one call at a time with 25 req/s rate limit
    for (const c of batch) {
      try {
        const result = await ethCall(c.data);
        results.set(c.id, result);
      } catch (err) {
        console.error(`[rpc] Failed to fetch validator ${c.id}:`, err);
      }
      // Small delay to respect rate limits (25 req/s)
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return results;
}

export interface EpochInfo {
  epoch: number;
  inDelayPeriod: boolean;
}

export interface ValidatorSnapshot {
  validatorId: number;
  authAddress: string;
  flags: number;
  stakeWei: bigint;
  stakeMon: number;
  accRewardPerToken: bigint;
  commission: bigint;
  unclaimedRewards: bigint;
  consensusStake: bigint;
  consensusCommission: bigint;
}

/** Fetch current epoch number */
export async function getEpoch(): Promise<EpochInfo> {
  const result = await ethCall(GET_EPOCH);
  const hex = result.slice(2);
  return {
    epoch: Number(BigInt("0x" + hex.slice(0, 64))),
    inDelayPeriod: BigInt("0x" + hex.slice(64, 128)) !== BigInt(0),
  };
}

/** Fetch all active validator IDs from consensus set */
export async function getConsensusValidatorIds(): Promise<number[]> {
  const allIds: number[] = [];
  let startIndex = 0;
  let isDone = false;

  while (!isDone) {
    const data = GET_CONSENSUS_VALIDATOR_SET + encodeUint32(startIndex);
    const result = await ethCall(data);
    const hex = result.slice(2);

    isDone = BigInt("0x" + hex.slice(0, 64)) !== BigInt(0);
    startIndex = Number(BigInt("0x" + hex.slice(64, 128)));

    const arrayOffset = Number(BigInt("0x" + hex.slice(128, 192))) * 2;
    const arrayLen = Number(
      BigInt("0x" + hex.slice(arrayOffset, arrayOffset + 64))
    );

    for (let i = 0; i < arrayLen; i++) {
      const start = arrayOffset + 64 + i * 64;
      const valId = Number(BigInt("0x" + hex.slice(start, start + 64)));
      allIds.push(valId);
    }
  }

  return allIds;
}

/** Decode a getValidator response hex string */
function decodeValidatorResponse(
  hex: string,
  validatorId: number
): ValidatorSnapshot {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const slot = (n: number) => BigInt("0x" + h.slice(n * 64, (n + 1) * 64));

  const stakeWei = slot(2);
  return {
    validatorId,
    authAddress: "0x" + h.slice(24, 64), // last 20 bytes of slot 0
    flags: Number(slot(1)),
    stakeWei,
    stakeMon: Number(stakeWei / WEI_PER_MON),
    accRewardPerToken: slot(3),
    commission: slot(4),
    unclaimedRewards: slot(5),
    consensusStake: slot(6),
    consensusCommission: slot(7),
  };
}

/** Fetch full validator data for a list of validator IDs */
export async function getValidators(
  validatorIds: number[]
): Promise<ValidatorSnapshot[]> {
  const calls = validatorIds.map((id, i) => ({
    data: GET_VALIDATOR + encodeUint64(BigInt(id)),
    id: i,
  }));

  const results = await batchEthCall(calls);
  const snapshots: ValidatorSnapshot[] = [];

  for (let i = 0; i < validatorIds.length; i++) {
    const hex = results.get(i);
    if (hex) {
      snapshots.push(decodeValidatorResponse(hex, validatorIds[i]));
    }
  }

  return snapshots;
}

/** Fetch MON price from CoinGecko */
export async function getMonPrice(): Promise<number> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd",
      { next: { revalidate: 300 } }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    const price = data?.monad?.usd;
    return typeof price === "number" && isFinite(price) && price > 0
      ? price
      : 0;
  } catch {
    return 0;
  }
}

/**
 * Calculate block reward income between two accumulator snapshots.
 *
 * Formula: reward_wei = (accNew - accOld) * stakeWei / 10^18
 * Then convert to MON: reward_mon = reward_wei / 10^18
 *
 * This gives the TOTAL block rewards for the validator's stake.
 * Commission income = total_rewards * commission_rate
 * Delegator rewards = total_rewards * (1 - commission_rate)
 */
export function calculateEpochReward(
  accOld: bigint,
  accNew: bigint,
  stakeWei: bigint
): { totalRewardMon: number; rewardWei: bigint } {
  if (accNew <= accOld) return { totalRewardMon: 0, rewardWei: BigInt(0) };

  const delta = accNew - accOld;
  const rewardWei = (delta * stakeWei) / WEI_PER_MON;
  const totalRewardMon = Number(rewardWei) / Number(WEI_PER_MON);

  return { totalRewardMon, rewardWei };
}
