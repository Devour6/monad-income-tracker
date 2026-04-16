import type { CalculatorInputs, CalculatorResults, Verdict } from "@/lib/types";
import { BLOCKS_PER_DAY, BLOCK_REWARD } from "@/lib/constants";

export function calculateProfit(inputs: CalculatorInputs): CalculatorResults {
  const {
    stake,
    selfStake: rawSelfStake,
    commission: commissionPct,
    monPrice,
    networkStake,
    priorityFees,
    serverCost,
    otherCosts,
  } = inputs;

  const annualCostsUsd = (serverCost + otherCosts) * 12;

  // Guard against division by zero — return zeroed results with costs
  if (networkStake <= 0 || monPrice <= 0) {
    return {
      networkShare: 0, blocksPerDay: 0, dailyBlockRewards: 0,
      dailyCommission: 0, dailySelfRewards: 0, dailyPriorityFees: 0,
      dailyTotalMon: 0, annualTotalMon: 0, annualRevenueUsd: 0,
      annualCostsUsd, netProfitUsd: -annualCostsUsd,
      monthlyProfitUsd: -annualCostsUsd / 12, effectiveApy: 0, grossApy: 0,
    };
  }

  const commission = commissionPct / 100;

  // Clamp selfStake to totalStake
  const selfStake =
    rawSelfStake > stake && stake > 0 ? stake : rawSelfStake;

  const networkShare = stake / networkStake;
  const blocksPerDay = BLOCKS_PER_DAY * networkShare;
  const dailyBlockRewards = blocksPerDay * BLOCK_REWARD;

  const delegatedStake = Math.max(0, stake - selfStake);
  const delegatorShareOfRewards =
    stake > 0 ? dailyBlockRewards * (delegatedStake / stake) : 0;
  const dailyCommission = delegatorShareOfRewards * commission;
  const dailySelfRewards =
    stake > 0 ? dailyBlockRewards * (selfStake / stake) : 0;

  const dailyPriorityFees = priorityFees;
  const dailyTotalMon = dailyCommission + dailySelfRewards + dailyPriorityFees;
  const annualTotalMon = dailyTotalMon * 365;
  const annualRevenueUsd = annualTotalMon * monPrice;
  const netProfitUsd = annualRevenueUsd - annualCostsUsd;
  const monthlyProfitUsd = netProfitUsd / 12;
  const effectiveApy =
    selfStake > 0 ? ((dailyTotalMon * 365) / selfStake) * 100 : 0;
  const grossApy =
    stake > 0 ? ((dailyBlockRewards * 365) / stake) * 100 : 0;

  return {
    networkShare,
    blocksPerDay,
    dailyBlockRewards,
    dailyCommission,
    dailySelfRewards,
    dailyPriorityFees,
    dailyTotalMon,
    annualTotalMon,
    annualRevenueUsd,
    annualCostsUsd,
    netProfitUsd,
    monthlyProfitUsd,
    effectiveApy,
    grossApy,
  };
}

export function calculateValidatorProfit(
  totalStake: number,
  selfStake: number,
  commissionPct: number,
  networkStake: number,
  monPrice: number,
  serverCost: number,
  otherCosts: number,
  priorityFees: number
): number {
  if (totalStake <= 0 || networkStake <= 0 || monPrice <= 0) return 0;
  const clampedSelf = selfStake > totalStake ? totalStake : selfStake;
  const commission = commissionPct / 100;
  const networkShare = totalStake / networkStake;
  const blocksPerDay = BLOCKS_PER_DAY * networkShare;
  const dailyBlockRewards = blocksPerDay * BLOCK_REWARD;
  const delegatedStake = Math.max(0, totalStake - clampedSelf);
  const delegatorShareOfRewards = dailyBlockRewards * (delegatedStake / totalStake);
  const dailyCommission = delegatorShareOfRewards * commission;
  const dailySelfRewards = dailyBlockRewards * (clampedSelf / totalStake);
  const dailyTotalMon = dailyCommission + dailySelfRewards + priorityFees;
  const annualTotalMon = dailyTotalMon * 365;
  const annualRevenueUsd = annualTotalMon * monPrice;
  const annualCostsUsd = (serverCost + otherCosts) * 12;
  return annualRevenueUsd - annualCostsUsd;
}

export function calculateBreakevenStake(
  selfStake: number,
  commissionPct: number,
  monPrice: number,
  networkStake: number,
  priorityFees: number,
  serverCost: number,
  otherCosts: number
): number {
  if (monPrice <= 0 || networkStake <= 0) return selfStake;

  const c = commissionPct / 100;
  const K = (BLOCKS_PER_DAY * BLOCK_REWARD) / networkStake;
  const annualCosts = (serverCost + otherCosts) * 12;
  const dailyMONNeeded = annualCosts / (365 * monPrice);
  const netDailyNeeded = dailyMONNeeded - priorityFees;

  if (netDailyNeeded <= 0) return selfStake;

  if (c <= 0) {
    // No commission — income is only from self-stake, can't solve for total stake
    return selfStake;
  }

  const breakeven = (netDailyNeeded / K - selfStake * (1 - c)) / c;
  return Math.max(Math.ceil(breakeven), selfStake);
}

// Verdict thresholds (USD)
const VERDICT_PROFITABLE = 1000;

export function getVerdict(netProfitUsd: number): Verdict {
  if (netProfitUsd > VERDICT_PROFITABLE) return "profitable";
  if (netProfitUsd >= 0) return "marginal";
  return "unprofitable";
}

export function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): string {
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(a[0] + (b[0] - a[0]) * clamped);
  const g = Math.round(a[1] + (b[1] - a[1]) * clamped);
  const bl = Math.round(a[2] + (b[2] - a[2]) * clamped);
  return `rgb(${r},${g},${bl})`;
}

// Phase palette RGB values for gradient interpolation
const PHASE_RED: [number, number, number] = [248, 113, 113];   // #f87171
const PHASE_YELLOW: [number, number, number] = [250, 204, 21]; // #facc15
const PHASE_GREEN: [number, number, number] = [74, 222, 128];  // #4ade80

export function profitColor(profit: number): string {
  if (!isFinite(profit)) return `rgb(${PHASE_YELLOW.join(",")})`;
  if (profit <= -2000) return `rgb(${PHASE_RED.join(",")})`;
  if (profit <= 0) {
    const t = (profit + 2000) / 2000;
    return lerpColor(PHASE_RED, PHASE_YELLOW, t);
  }
  if (profit <= 5000) {
    const t = profit / 5000;
    return lerpColor(PHASE_YELLOW, PHASE_GREEN, t);
  }
  return `rgb(${PHASE_GREEN.join(",")})`;
}
