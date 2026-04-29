CREATE TABLE IF NOT EXISTS "epoch_priority_fees" (
  "id" serial PRIMARY KEY NOT NULL,
  "epoch" integer NOT NULL,
  "validator_id" integer NOT NULL,
  "priority_fees_wei" text NOT NULL,
  "blocks_proposed" integer DEFAULT 0 NOT NULL,
  "first_block" bigint,
  "last_block" bigint,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "epoch_validator_pf_idx" ON "epoch_priority_fees" ("epoch","validator_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "indexer_state" (
  "id" serial PRIMARY KEY NOT NULL,
  "last_block" bigint NOT NULL,
  "last_epoch" integer,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
