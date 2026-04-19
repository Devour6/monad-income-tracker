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
const GET_EXECUTION_VALIDATOR_SET = "0x7cb074df";
const GET_VALIDATOR = "0x2b6d639a";

const WEI_PER_MON = BigInt(10) ** BigInt(18);

function encodeUint32(n: number): string {
  return n.toString(16).padStart(64, "0");
}

function encodeUint64(n: bigint): string {
  return n.toString(16).padStart(64, "0");
}

async function ethCall(data: string, timeoutMs = 10000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(MONAD_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{ to: STAKING_CONTRACT, data }, "latest"],
        id: 1,
      }),
      signal: controller.signal,
    });
    const json = await res.json();
    if (json.error) throw new Error(`RPC error: ${json.error.message}`);
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Batch fetch multiple eth_call results.
 * Monad RPC doesn't support JSON-RPC batch arrays, so we use
 * concurrent individual calls with conservative concurrency (10 at a time)
 * to stay safely within the 25 req/s rate limit.
 */
async function batchEthCall(
  calls: { data: string; id: number }[]
): Promise<Map<number, string>> {
  const results = new Map<number, string>();
  const CONCURRENCY = 10; // Conservative to avoid rate limiting
  const MAX_RETRIES = 2;

  let pending = [...calls];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const failed: { data: string; id: number }[] = [];

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const chunk = pending.slice(i, i + CONCURRENCY);

      const settled = await Promise.allSettled(
        chunk.map(async (c) => {
          const result = await ethCall(c.data);
          return { id: c.id, result };
        })
      );

      for (let j = 0; j < settled.length; j++) {
        const s = settled[j];
        if (s.status === "fulfilled") {
          results.set(s.value.id, s.value.result);
        } else {
          failed.push(chunk[j]);
        }
      }

      // 500ms pause between chunks to stay well under rate limits
      if (i + CONCURRENCY < pending.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    if (failed.length === 0) break;

    if (attempt < MAX_RETRIES) {
      console.log(
        `[rpc] Retrying ${failed.length} failed calls (attempt ${attempt + 2}/${MAX_RETRIES + 1})`
      );
      // Back off before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000));
      pending = failed;
    } else {
      console.log(
        `[rpc] ${failed.length} calls still failed after ${MAX_RETRIES + 1} attempts`
      );
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

/** Decode a paginated validator set response (shared by consensus/execution/snapshot) */
function decodePaginatedValidatorSet(result: string): {
  isDone: boolean;
  nextIndex: number;
  ids: number[];
} {
  const hex = result.slice(2);
  const isDone = BigInt("0x" + hex.slice(0, 64)) !== BigInt(0);
  const nextIndex = Number(BigInt("0x" + hex.slice(64, 128)));
  const arrayOffset = Number(BigInt("0x" + hex.slice(128, 192))) * 2;
  const arrayLen = Number(
    BigInt("0x" + hex.slice(arrayOffset, arrayOffset + 64))
  );
  const ids: number[] = [];
  for (let i = 0; i < arrayLen; i++) {
    const start = arrayOffset + 64 + i * 64;
    ids.push(Number(BigInt("0x" + hex.slice(start, start + 64))));
  }
  return { isDone, nextIndex, ids };
}

/** Fetch all active validator IDs from consensus set (~48 validators) */
export async function getConsensusValidatorIds(): Promise<number[]> {
  const allIds: number[] = [];
  let startIndex = 0;
  let isDone = false;

  while (!isDone) {
    const data = GET_CONSENSUS_VALIDATOR_SET + encodeUint32(startIndex);
    const result = await ethCall(data);
    const parsed = decodePaginatedValidatorSet(result);
    isDone = parsed.isDone;
    startIndex = parsed.nextIndex;
    allIds.push(...parsed.ids);
  }

  return allIds;
}

/** Fetch all active validator IDs from execution set (up to 200 — the broadest active set) */
export async function getExecutionValidatorIds(): Promise<number[]> {
  const allIds: number[] = [];
  let startIndex = 0;
  let isDone = false;

  while (!isDone) {
    const data = GET_EXECUTION_VALIDATOR_SET + encodeUint32(startIndex);
    const result = await ethCall(data);
    const parsed = decodePaginatedValidatorSet(result);
    isDone = parsed.isDone;
    startIndex = parsed.nextIndex;
    allIds.push(...parsed.ids);
  }

  return allIds;
}

/**
 * Enumerate ALL registered validators by brute-force iteration.
 * Starts from ID 1 and goes up to maxId + buffer.
 * Returns IDs for all validators with non-zero stake or authAddress.
 */
export async function enumerateAllValidatorIds(
  knownMaxId?: number
): Promise<number[]> {
  const maxToScan = (knownMaxId ?? 200) + 50;
  const allIds: number[] = [];

  // Build batch calls for all IDs
  const calls = [];
  for (let id = 1; id <= maxToScan; id++) {
    calls.push({
      data: GET_VALIDATOR + encodeUint64(BigInt(id)),
      id,
    });
  }

  const results = await batchEthCall(calls);

  for (let id = 1; id <= maxToScan; id++) {
    const hex = results.get(id);
    if (!hex || hex === "0x") continue;

    try {
      const h = hex.startsWith("0x") ? hex.slice(2) : hex;
      // Check authAddress (slot 0) — zero means non-existent
      const authAddr = h.slice(24, 64);
      if (authAddr === "0".repeat(40)) continue;

      // Check stake (slot 2) — zero stake means inactive but registered
      const stakeWei = BigInt("0x" + h.slice(128, 192));

      // Include if they have any stake at all
      if (stakeWei > BigInt(0)) {
        allIds.push(id);
      }
    } catch {
      // Skip if can't decode — probably past the last validator
      continue;
    }
  }

  return allIds;
}

/**
 * Get the broadest possible validator set.
 * Strategy:
 * 1. Try getExecutionValidatorSet (up to 200 active validators)
 * 2. If that fails, fall back to getConsensusValidatorSet
 * 3. Optionally brute-force enumerate to catch inactive validators
 */
export async function getAllValidatorIds(
  includeInactive = false
): Promise<number[]> {
  let ids: number[];

  try {
    ids = await getExecutionValidatorIds();
    console.log(`[rpc] Execution validator set: ${ids.length} validators`);
  } catch (err) {
    console.log(
      `[rpc] Execution set failed, falling back to consensus:`,
      err
    );
    ids = await getConsensusValidatorIds();
    console.log(`[rpc] Consensus validator set: ${ids.length} validators`);
  }

  if (includeInactive) {
    const maxKnown = Math.max(...ids);
    const allIds = await enumerateAllValidatorIds(maxKnown);
    // Merge — use a Set to deduplicate
    const merged = new Set([...ids, ...allIds]);
    const result = Array.from(merged).sort((a, b) => a - b);
    console.log(
      `[rpc] Full enumeration: ${result.length} total (${ids.length} active + ${result.length - ids.length} additional)`
    );
    return result;
  }

  return ids;
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
  const missing: number[] = [];

  for (let i = 0; i < validatorIds.length; i++) {
    const hex = results.get(i);
    if (hex) {
      snapshots.push(decodeValidatorResponse(hex, validatorIds[i]));
    } else {
      missing.push(validatorIds[i]);
    }
  }

  // Individual retry pass for any stragglers with longer timeout
  if (missing.length > 0) {
    console.log(
      `[rpc] Retrying ${missing.length} missing validators individually`
    );
    for (const id of missing) {
      try {
        const hex = await ethCall(
          GET_VALIDATOR + encodeUint64(BigInt(id)),
          15000
        );
        if (hex) {
          snapshots.push(decodeValidatorResponse(hex, id));
        }
      } catch {
        console.log(`[rpc] Validator ${id} failed final retry`);
      }
      // Small delay between individual retries
      await new Promise((resolve) => setTimeout(resolve, 200));
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
  // Keep in BigInt until final division to avoid precision loss above 2^53
  const rewardMon = rewardWei / WEI_PER_MON;
  const remainder = rewardWei % WEI_PER_MON;
  const totalRewardMon = Number(rewardMon) + Number(remainder) / Number(WEI_PER_MON);

  return { totalRewardMon, rewardWei };
}
