import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";

/**
 * Operator-claimable validator metadata. One row per validator_id.
 *
 * Claim flow:
 *   1. Operator hits POST /api/admin/validator-metadata with a one-time
 *      claim secret + their validator_id. We hash and store it.
 *   2. Subsequent edits require the same secret in `X-Validator-Secret`.
 *   3. `verified` is admin-flipped after off-chain verification (optional).
 *
 * Public surface only ever returns the non-sensitive columns.
 */
export const validatorMetadata = pgTable(
  "validator_metadata",
  {
    id: serial("id").primaryKey(),
    validatorId: integer("validator_id").notNull().unique(),
    /** URL-safe slug for /v/[slug] routing. Lowercase, hyphenated. */
    slug: text("slug").unique(),
    /** Display name override (falls back to validators.name). */
    displayName: text("display_name"),
    /** Markdown-ish short description. */
    description: text("description"),
    website: text("website"),
    twitter: text("twitter"),
    discord: text("discord"),
    logoUrl: text("logo_url"),
    /** SHA-256 hex of the claim secret. Server checks via constant-time
     *  compare on update. */
    claimSecretHash: text("claim_secret_hash"),
    /** Admin flag — operator's identity has been off-chain verified. */
    verified: boolean("verified").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("validator_metadata_slug_idx").on(table.slug)]
);

export type ValidatorMetadata = typeof validatorMetadata.$inferSelect;
export type NewValidatorMetadata = typeof validatorMetadata.$inferInsert;
