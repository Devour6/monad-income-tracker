import type { PresetConfig, CalculatorInputs } from "@/lib/types";

export const BLOCKS_PER_DAY = 216000;
export const BLOCK_REWARD = 25;
export const DEFAULT_MON_PRICE = 0.022;
export const DEFAULT_TOTAL_STAKED = 12355710073;
export const DEFAULT_ACTIVE_VALIDATORS = 169;
export const MAX_VALIDATORS = 200;

export const PRESETS: PresetConfig[] = [
  {
    id: "vdp-t1",
    label: "VDP Tier 1",
    stake: 90000000,
    selfStake: 100000,
    commission: 20,
  },
  {
    id: "vdp-t2",
    label: "VDP Tier 2",
    stake: 75000000,
    selfStake: 100000,
    commission: 20,
  },
  {
    id: "vdp-t3",
    label: "VDP Tier 3",
    stake: 52600000,
    selfStake: 100000,
    commission: 20,
  },
  {
    id: "vdp-t4",
    label: "VDP Tier 4",
    stake: 15100000,
    selfStake: 100000,
    commission: 20,
  },
  {
    id: "custom",
    label: "Custom",
    stake: 50000000,
    selfStake: 5000000,
    commission: 15,
  },
];

export const DEFAULT_INPUTS: CalculatorInputs = {
  stake: 50000000,
  selfStake: 100000,
  commission: 20,
  monPrice: DEFAULT_MON_PRICE,
  networkStake: DEFAULT_TOTAL_STAKED,
  activeValidators: DEFAULT_ACTIVE_VALIDATORS,
  priorityFees: 0,
  serverCost: 583.33,
  otherCosts: 0,
};
