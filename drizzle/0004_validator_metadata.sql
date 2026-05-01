-- Operator-claimable validator metadata. One row per validator_id.
-- Claim is gated by a per-validator secret (operators set it via admin
-- endpoint; rotating clears prior claim).
CREATE TABLE IF NOT EXISTS "validator_metadata" (
  "id" serial PRIMARY KEY NOT NULL,
  "validator_id" integer NOT NULL UNIQUE,
  "slug" text UNIQUE,
  "display_name" text,
  "description" text,
  "website" text,
  "twitter" text,
  "discord" text,
  "logo_url" text,
  "claim_secret_hash" text,
  "verified" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "validator_metadata_slug_idx" ON "validator_metadata" ("slug");
