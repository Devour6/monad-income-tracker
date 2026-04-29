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

/**
 * Per-epoch priority-fee aggregate, sourced from block-by-block indexing.
 * Keyed by (epoch, minerAddress) — Monad's `block.miner` field is what
 * physically produces blocks and may be a contract OR EOA. For some
 * validators it equals their staking-precompile authAddress; for others
 * it's a separate account (often a distributor contract). We store the
 * raw miner address and resolve to validator_id at query time via the
 * `minerAliases` mapping below.
 *
 * priorityFeesWei = sum over every block produced by miner in epoch:
 *   sum over every tx in block of:
 *     gasUsed * (effectiveGasPrice - baseFeePerGas)
 *
 * Tx 0 is filtered (system distribution tx with gasUsed=0).
 */
export const epochPriorityFees = pgTable(
  "epoch_priority_fees",
  {
    id: serial("id").primaryKey(),
    epoch: integer("epoch").notNull(),
    /** Lowercased 0x-prefixed block miner address */
    minerAddress: text("miner_address").notNull(),
    /** Sum of priority fees in wei (uint256 as text) */
    priorityFeesWei: text("priority_fees_wei").notNull(),
    /** Number of blocks this miner proposed in this epoch */
    blocksProposed: integer("blocks_proposed").notNull().default(0),
    /** Lowest block we've counted for this row (inclusive) */
    firstBlock: bigint("first_block", { mode: "bigint" }),
    /** Highest block we've counted for this row (inclusive) */
    lastBlock: bigint("last_block", { mode: "bigint" }),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("epoch_miner_pf_idx").on(table.epoch, table.minerAddress),
  ]
);

/**
 * Maps a block-producer address (from `block.miner`) to a validator_id
 * in our staking-precompile namespace. Some validators produce blocks
 * directly under their authAddress; others use a separate EOA or a
 * distributor contract. This table is the single source of truth.
 *
 * Auto-populated by the indexer when `miner == authAddress`. Manually
 * seeded for distributor-contract cases via `/api/admin/map-miner`.
 */
export const minerAliases = pgTable("miner_aliases", {
  id: serial("id").primaryKey(),
  /** Lowercased 0x-prefixed block miner address (unique) */
  minerAddress: text("miner_address").notNull().unique(),
  validatorId: integer("validator_id").notNull(),
  /** 'auth' = miner==authAddress; 'manual' = operator-provided mapping */
  source: text("source").notNull().default("auto"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Indexer cursor — single-row table tracking how far the block indexer has
 * advanced. The next run resumes from `lastBlock + 1`.
 */
export const indexerState = pgTable("indexer_state", {
  id: serial("id").primaryKey(),
  /** Highest block we've fully processed */
  lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
  /** Highest epoch we've seen any block of */
  lastEpoch: integer("last_epoch"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type EpochSnapshot = typeof epochSnapshots.$inferSelect;
export type NewEpochSnapshot = typeof epochSnapshots.$inferInsert;
export type Validator = typeof validators.$inferSelect;
export type NetworkEpoch = typeof networkEpochs.$inferSelect;
export type EpochPriorityFees = typeof epochPriorityFees.$inferSelect;
export type IndexerState = typeof indexerState.$inferSelect;
export type MinerAlias = typeof minerAliases.$inferSelect;
