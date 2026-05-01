-- Alerts: user-defined watchlist rules that fire when validator metrics
-- cross thresholds. Notifications are delivered via webhook URL (Discord,
-- Slack, generic JSON POST). No email infra.
CREATE TABLE IF NOT EXISTS "alerts" (
  "id" serial PRIMARY KEY NOT NULL,
  "validator_id" integer NOT NULL,
  -- Rule kind: 'commission_change' | 'missed_blocks' | 'apy_drop' | 'self_stake_change'
  "kind" text NOT NULL,
  -- Threshold semantics depend on kind:
  --  commission_change: any change of >= threshold percentage points
  --  missed_blocks: production efficiency below threshold (e.g. 0.5)
  --  apy_drop: pool APY drops by >= threshold %
  --  self_stake_change: self-stake changes by >= threshold MON
  "threshold" numeric(20, 8) NOT NULL,
  -- Webhook URL — Discord, Slack incoming webhook, or generic POST endpoint.
  "webhook_url" text NOT NULL,
  -- Optional human label for the rule.
  "label" text,
  -- Owner secret — random token returned on create, required to delete.
  -- Stateless: no accounts, no login, just possession of the secret.
  "owner_secret" text NOT NULL,
  -- Track last-known value so we can detect changes between cron runs.
  "last_value" numeric(30, 8),
  "last_fired_at" timestamp,
  "fire_count" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_validator_active_idx" ON "alerts" ("validator_id", "active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_kind_active_idx" ON "alerts" ("kind", "active");
--> statement-breakpoint
-- Fire log — every time an alert triggers, we append a row. Lets users see
-- a history without hammering the webhook destination.
CREATE TABLE IF NOT EXISTS "alert_fires" (
  "id" serial PRIMARY KEY NOT NULL,
  "alert_id" integer NOT NULL,
  "epoch" integer NOT NULL,
  "old_value" numeric(30, 8),
  "new_value" numeric(30, 8),
  "message" text NOT NULL,
  "delivered" boolean DEFAULT false NOT NULL,
  "delivery_error" text,
  "fired_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_fires_alert_idx" ON "alert_fires" ("alert_id", "fired_at");
