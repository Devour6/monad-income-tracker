/**
 * APY computation utility for Monad staking rewards.
 *
 * Computes annualized yield from accumulator deltas.
 *
 * Formula:
 *   epoch_return = (accNew - accOld) * stakeWei / 10^18 / 10^18 / stakeMon
 *   epochs_per_year = 4.36 * 365
 *   apy = epoch_return * epochs_per_year * 100
 *
 * For multi-epoch spans, divide by number of epochs to get per-epoch return.
 */

const WEI_PER_MON = BigInt(10) ** BigInt(18);

/** ~4.36 epochs per day on Monad (50,000 blocks/epoch, ~216,000 blocks/day) */
export const EPOCHS_PER_DAY = 4.36;

/** Annualized epoch count */
export const EPOCHS_PER_YEAR = EPOCHS_PER_DAY * 365; // 1591.4

/**
 * Compute annualized percentage yield from accumulator deltas.
 *
 * @param accOld  - Accumulator value at the earlier epoch (uint256 as bigint)
 * @param accNew  - Accumulator value at the later epoch (uint256 as bigint)
 * @param stakeWei - Validator stake in wei (uint256 as bigint)
 * @param epochSpan - Number of epochs between accOld and accNew (>= 1)
 * @returns APY as a percentage (e.g. 12.34 means 12.34%)
 */
export function computeApy(
  accOld: bigint,
  accNew: bigint,
  stakeWei: bigint,
  epochSpan: number
): number {
  if (accNew <= accOld || stakeWei <= BigInt(0) || epochSpan <= 0) {
    return 0;
  }

  // Reward in wei for the full epoch span:
  //   rewardWei = (accNew - accOld) * stakeWei / 10^18
  const delta = accNew - accOld;
  const rewardWei = (delta * stakeWei) / WEI_PER_MON;

  // Convert rewardWei to MON (divide by 10^18 again)
  const rewardMon =
    Number(rewardWei / WEI_PER_MON) +
    Number(rewardWei % WEI_PER_MON) / Number(WEI_PER_MON);

  // Convert stakeWei to MON
  const stakeMon =
    Number(stakeWei / WEI_PER_MON) +
    Number(stakeWei % WEI_PER_MON) / Number(WEI_PER_MON);

  if (stakeMon <= 0) return 0;

  // Per-epoch return as a fraction of stake
  const epochReturn = rewardMon / stakeMon / epochSpan;

  // Annualize and convert to percentage
  const apy = epochReturn * EPOCHS_PER_YEAR * 100;

  return apy;
}

/**
 * Format APY as a percentage string.
 * @example formatApy(12.3456) => "12.35%"
 */
export function formatApy(apy: number): string {
  if (!isFinite(apy) || apy === 0) return "0.00%";
  return `${apy.toFixed(2)}%`;
}

/**
 * Format a MON amount for display with appropriate suffix.
 * @example formatMon(1234567) => "1.23M"
 */
export function formatMon(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

/**
 * Format a USD amount for display with appropriate suffix.
 * Returns empty string for zero/falsy values.
 * @example formatUsd(1234567) => "$1.23M"
 */
export function formatUsd(n: number): string {
  if (!n || n === 0) return "";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

/**
 * Format a stake amount in MON for compact display.
 * @example formatStake(1234567) => "1.2M"
 */
export function formatStake(mon: number): string {
  if (mon >= 1_000_000_000) return `${(mon / 1_000_000_000).toFixed(1)}B`;
  if (mon >= 1_000_000) return `${(mon / 1_000_000).toFixed(1)}M`;
  if (mon >= 1_000) return `${(mon / 1_000).toFixed(1)}K`;
  return mon.toFixed(0);
}
