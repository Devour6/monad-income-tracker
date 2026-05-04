/**
 * Drizzle schema for the claim_events + claim_indexer_state tables.
 *
 * Defined in a separate file (not src/lib/db/schema.ts) so this can land
 * without touching the rest of the schema. Drizzle is happy reading from
 * multiple schema files; only drizzle-kit codegen cares about the central
 * schema.ts for migration generation, and we write the SQL migration
 * (drizzle/0005_claim_events.sql) by hand.
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

export const claimEvents = pgTable(
  "claim_events",
  {
    id: serial("id").primaryKey(),
    validatorId: integer("validator_id").notNull(),
    delegator: text("delegator").notNull(),
    amountWei: numeric("amount_wei", { precision: 78, scale: 0 }).notNull(),
    epoch: integer("epoch").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTimestamp: timestamp("block_timestamp", {
      withTimezone: true,
    }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    txLogIdx: uniqueIndex("claim_events_tx_log_idx").on(t.txHash, t.logIndex),
    validatorIdx: index("claim_events_validator_idx").on(
      t.validatorId,
      t.blockNumber
    ),
    delegatorIdx: index("claim_events_delegator_idx").on(
      t.delegator,
      t.blockNumber
    ),
    blockIdx: index("claim_events_block_idx").on(t.blockNumber),
  })
);

export const claimIndexerState = pgTable("claim_indexer_state", {
  id: integer("id").primaryKey(),
  lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type ClaimEvent = typeof claimEvents.$inferSelect;
export type NewClaimEvent = typeof claimEvents.$inferInsert;
