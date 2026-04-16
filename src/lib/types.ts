export interface ValidatorData {
  name: string;
  totalStake: number;
  selfStake: number;
  commission: number;
}

export interface CalculatorInputs {
  stake: number;
  selfStake: number;
  commission: number;
  monPrice: number;
  networkStake: number;
  activeValidators: number;
  priorityFees: number;
  serverCost: number;
  otherCosts: number;
}

export interface CalculatorResults {
  networkShare: number;
  blocksPerDay: number;
  dailyBlockRewards: number;
  dailyCommission: number;
  dailySelfRewards: number;
  dailyPriorityFees: number;
  dailyTotalMon: number;
  annualTotalMon: number;
  annualRevenueUsd: number;
  annualCostsUsd: number;
  netProfitUsd: number;
  monthlyProfitUsd: number;
  effectiveApy: number;
  grossApy: number;
}

export type Verdict = "profitable" | "marginal" | "breakeven" | "unprofitable";

export type SortColumn =
  | "index"
  | "name"
  | "totalStake"
  | "selfStake"
  | "commission"
  | "profit";

export type SortDirection = "asc" | "desc";

export interface PresetConfig {
  id: string;
  label: string;
  stake: number;
  selfStake: number;
  commission: number;
}
