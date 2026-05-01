import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  numeric,
  boolean,
  index,
} from "drizzle-orm/pg-core";

/**
 * Alerts — user-defined watchlist rules that fire when validator metrics
 * cross thresholds. Notifications are delivered via webhook URL (Discord,
 * Slack, generic JSON POST). No accounts, no email infra: each rule is
 * gated by a random `owner_secret` returned on create and required to
 * delete or toggle.
 *
 * This module is intentionally separate from schema.ts so it can be
 * imported standalone by alert-related routes without coupling to the
 * core schema. SQL migration lives at drizzle/0003_alerts.sql.
 */
export const alerts = pgTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    validatorId: integer("validator_id").notNull(),
    /** 'commission_change' | 'missed_blocks' | 'apy_drop' | 'self_stake_change' */
    kind: text("kind").notNull(),
    /** Threshold semantics depend on `kind`:
     *  - commission_change: any change of >= threshold percentage points
     *  - missed_blocks:     production efficiency < threshold (e.g. 0.5)
     *  - apy_drop:          pool APY drops by >= threshold percentage points
     *  - self_stake_change: self-stake changes by >= threshold MON
     */
    threshold: numeric("threshold", { precision: 20, scale: 8 }).notNull(),
    webhookUrl: text("webhook_url").notNull(),
    label: text("label"),
    /** Random secret returned to the creator; required to delete/toggle. */
    ownerSecret: text("owner_secret").notNull(),
    /** Last observed value of the metric this rule watches. */
    lastValue: numeric("last_value", { precision: 30, scale: 8 }),
    lastFiredAt: timestamp("last_fired_at"),
    fireCount: integer("fire_count").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("alerts_validator_active_idx").on(t.validatorId, t.active),
    index("alerts_kind_active_idx").on(t.kind, t.active),
  ],
);

/**
 * Fire log — append-only history of every time an alert triggered.
 * Surfaces in the /alerts UI without hammering the webhook destination.
 */
export const alertFires = pgTable(
  "alert_fires",
  {
    id: serial("id").primaryKey(),
    alertId: integer("alert_id").notNull(),
    epoch: integer("epoch").notNull(),
    oldValue: numeric("old_value", { precision: 30, scale: 8 }),
    newValue: numeric("new_value", { precision: 30, scale: 8 }),
    message: text("message").notNull(),
    delivered: boolean("delivered").notNull().default(false),
    deliveryError: text("delivery_error"),
    firedAt: timestamp("fired_at").defaultNow().notNull(),
  },
  (t) => [index("alert_fires_alert_idx").on(t.alertId, t.firedAt)],
);

export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
export type AlertFire = typeof alertFires.$inferSelect;
