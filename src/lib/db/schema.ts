import {
  pgTable,
  serial,
  integer,
  bigint,
  text,
  timestamp,
  numeric,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Epoch snapshots — one row per validator per epoch.
 * Stores the raw accRewardPerToken accumulator and stake at snapshot time.
 * Income is computed as the delta between consecutive snapshots.
 */
export const epochSnapshots = pgTable(
  "epoch_snapshots",
  {
    id: serial("id").primaryKey(),
    epoch: integer("epoch").notNull(),
    validatorId: integer("validator_id").notNull(),
    /** Raw accRewardPerToken from staking precompile (uint256 as text) */
    accRewardPerToken: text("acc_reward_per_token").notNull(),
    /** Validator total stake in wei (uint256 as text) */
    stakeWei: text("stake_wei").notNull(),
    /** Commission rate from precompile (raw uint256 as text) */
    commission: text("commission").notNull(),
    /** Unclaimed rewards in wei (uint256 as text) */
    unclaimedRewards: text("unclaimed_rewards").notNull(),
    /** Validator's own self-delegation stake in wei (uint256 as text). Nullable
     *  because historical rows predating self-stake tracking won't have it. */
    selfStakeWei: text("self_stake_wei"),
    /** Block reward income this epoch in MON (computed from accumulator delta) */
    blockRewardsMon: numeric("block_rewards_mon", {
      precision: 30,
      scale: 18,
    }),
    /** Commission income this epoch in MON */
    commissionMon: numeric("commission_mon", { precision: 30, scale: 18 }),
    /** Snapshot timestamp */
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("epoch_validator_idx").on(table.epoch, table.validatorId),
  ]
);

/**
 * Validator metadata — cached validator info.
 * Updated each polling cycle.
 */
export const validators = pgTable("validators", {
  id: serial("id").primaryKey(),
  validatorId: integer("validator_id").notNull().unique(),
  /** Auth address from precompile */
  authAddress: text("auth_address").notNull(),
  /** Human-readable name (from static mapping) */
  name: text("name"),
  /** Current stake in MON (for display) */
  stakeMon: numeric("stake_mon", { precision: 30, scale: 2 }),
  /** Current commission rate (percentage, 0-100) */
  commissionPct: numeric("commission_pct", { precision: 5, scale: 2 }),
  /** Last epoch we have data for */
  lastEpoch: integer("last_epoch"),
  /** Last update timestamp */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Network state — one row per epoch with aggregate data.
 */
export const networkEpochs = pgTable("network_epochs", {
  id: serial("id").primaryKey(),
  epoch: integer("epoch").notNull().unique(),
  /** Total network stake in MON */
  totalStakeMon: numeric("total_stake_mon", { precision: 30, scale: 2 }),
  /** Active validator count */
  activeValidators: integer("active_validators"),
  /** MON price in USD at snapshot time */
  monPriceUsd: numeric("mon_price_usd", { precision: 20, scale: 8 }),
  /** Snapshot timestamp */
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EpochSnapshot = typeof epochSnapshots.$inferSelect;
export type NewEpochSnapshot = typeof epochSnapshots.$inferInsert;
export type Validator = typeof validators.$inferSelect;
export type NetworkEpoch = typeof networkEpochs.$inferSelect;
