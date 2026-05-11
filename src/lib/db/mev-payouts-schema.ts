/**
 * Drizzle schema for mev_payouts + mev_indexer_state.
 *
 * Records every SendValidatorRewards event from the shMonad proxy
 * (0x1b68626dca36c7fe922fd2d55e4f631d962de19c). Each event represents
 * a MEV/priority-fee payout from a validator's Coinbase contract back
 * into the staking precompile (and on to delegators).
 */

import {
  pgTable,
  serial,
  integer,
  text,
  bigint,
  timestamp,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const mevPayouts = pgTable(
  "mev_payouts",
  {
    id: serial("id").primaryKey(),
    validatorId: integer("validator_id").notNull(),
    coinbase: text("coinbase").notNull(),
    validatorPayoutWei: numeric("validator_payout_wei", {
      precision: 78,
      scale: 0,
    }).notNull(),
    feeTakenWei: numeric("fee_taken_wei", {
      precision: 78,
      scale: 0,
    }).notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTimestamp: timestamp("block_timestamp", {
      withTimezone: true,
    }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    txLogIdx: uniqueIndex("mev_payouts_tx_log_idx").on(t.txHash, t.logIndex),
    validatorIdx: index("mev_payouts_validator_idx").on(
      t.validatorId,
      t.blockNumber
    ),
    blockIdx: index("mev_payouts_block_idx").on(t.blockNumber),
  })
);

export const mevIndexerState = pgTable("mev_indexer_state", {
  id: integer("id").primaryKey(),
  lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type MevPayout = typeof mevPayouts.$inferSelect;
export type NewMevPayout = typeof mevPayouts.$inferInsert;
