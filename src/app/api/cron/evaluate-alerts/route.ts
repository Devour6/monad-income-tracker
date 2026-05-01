import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { alerts, alertFires } from "@/lib/db/alerts";
import {
  epochSnapshots,
  epochPriorityFees,
  minerAliases,
} from "@/lib/db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

/**
 * GET /api/cron/evaluate-alerts
 *
 * Walks every active alert, recomputes the metric it watches, compares
 * against the stored last_value + threshold, and fires the webhook when
 * the rule trips. Designed for Vercel cron (every 30 min or so) — fast,
 * idempotent, and bounded in DB I/O.
 *
 * Auth: optional CRON_SECRET via Authorization header. If unset, allows
 * any caller (matches the existing /api/cron/snapshot pattern in this
 * repo).
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  try {
    const activeRules = await db
      .select()
      .from(alerts)
      .where(eq(alerts.active, true));

    if (activeRules.length === 0) {
      return NextResponse.json({
        evaluated: 0,
        fired: 0,
        elapsedMs: Date.now() - startedAt,
      });
    }

    // Pre-fetch latest 2 snapshots per validator referenced. Cheaper than
    // N round-trips when many rules share validators.
    const validatorIds = [
      ...new Set(activeRules.map((r) => r.validatorId)),
    ];
    const recentSnaps = await db
      .select()
      .from(epochSnapshots)
      .where(inArray(epochSnapshots.validatorId, validatorIds))
      .orderBy(desc(epochSnapshots.epoch));

    const snapsByValidator = new Map<
      number,
      typeof recentSnaps
    >();
    for (const s of recentSnaps) {
      const arr = snapsByValidator.get(s.validatorId) ?? [];
      if (arr.length < 8) arr.push(s); // keep last 8 epochs per validator
      snapsByValidator.set(s.validatorId, arr);
    }

    let firedCount = 0;
    const results: Array<{
      ruleId: number;
      kind: string;
      fired: boolean;
      reason?: string;
    }> = [];

    for (const rule of activeRules) {
      const snaps = snapsByValidator.get(rule.validatorId) ?? [];
      if (snaps.length < 2) {
        results.push({
          ruleId: rule.id,
          kind: rule.kind,
          fired: false,
          reason: "insufficient snapshot history",
        });
        continue;
      }
      const [curr, prev] = snaps; // newest first

      const evald = await evaluateRule(rule, curr, prev);
      if (!evald.shouldFire) {
        results.push({
          ruleId: rule.id,
          kind: rule.kind,
          fired: false,
          reason: evald.reason,
        });
        continue;
      }

      if (!dryRun) {
        const [fire] = await db
          .insert(alertFires)
          .values({
            alertId: rule.id,
            epoch: curr.epoch,
            oldValue: evald.oldValue != null ? String(evald.oldValue) : null,
            newValue: evald.newValue != null ? String(evald.newValue) : null,
            message: evald.message,
          })
          .returning({ id: alertFires.id });

        const delivery = await deliverWebhook(rule.webhookUrl, {
          ruleId: rule.id,
          validatorId: rule.validatorId,
          kind: rule.kind,
          epoch: curr.epoch,
          oldValue: evald.oldValue,
          newValue: evald.newValue,
          threshold: Number(rule.threshold),
          message: evald.message,
          label: rule.label,
        });

        await db
          .update(alertFires)
          .set({
            delivered: delivery.ok,
            deliveryError: delivery.ok ? null : delivery.error,
          })
          .where(eq(alertFires.id, fire.id));

        await db
          .update(alerts)
          .set({
            lastValue:
              evald.newValue != null ? String(evald.newValue) : rule.lastValue,
            lastFiredAt: new Date(),
            fireCount: rule.fireCount + 1,
          })
          .where(eq(alerts.id, rule.id));
      }

      firedCount++;
      results.push({
        ruleId: rule.id,
        kind: rule.kind,
        fired: true,
        reason: evald.message,
      });
    }

    return NextResponse.json({
      evaluated: activeRules.length,
      fired: firedCount,
      dryRun,
      elapsedMs: Date.now() - startedAt,
      results,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

interface SnapshotRow {
  epoch: number;
  validatorId: number;
  accRewardPerToken: string;
  stakeWei: string;
  commission: string;
  selfStakeWei: string | null;
}

interface EvalResult {
  shouldFire: boolean;
  reason: string;
  message: string;
  oldValue?: number | null;
  newValue?: number | null;
}

async function evaluateRule(
  rule: typeof alerts.$inferSelect,
  curr: SnapshotRow,
  prev: SnapshotRow,
): Promise<EvalResult> {
  const threshold = Number(rule.threshold);
  const lastVal = rule.lastValue != null ? Number(rule.lastValue) : null;

  switch (rule.kind) {
    case "commission_change": {
      const currPct = (Number(BigInt(curr.commission)) / 1e18) * 100;
      const baseline = lastVal ?? (Number(BigInt(prev.commission)) / 1e18) * 100;
      const delta = Math.abs(currPct - baseline);
      if (delta >= threshold) {
        return {
          shouldFire: true,
          reason: "commission moved",
          oldValue: baseline,
          newValue: currPct,
          message: `Commission ${baseline.toFixed(2)}% → ${currPct.toFixed(2)}% (Δ ${delta.toFixed(2)}pp) at epoch ${curr.epoch}`,
        };
      }
      return {
        shouldFire: false,
        reason: `Δ ${delta.toFixed(2)}pp < ${threshold}pp`,
        message: "",
      };
    }

    case "self_stake_change": {
      if (curr.selfStakeWei == null) {
        return {
          shouldFire: false,
          reason: "no self-stake data",
          message: "",
        };
      }
      const WEI = BigInt(10) ** BigInt(18);
      const currMon =
        Number(BigInt(curr.selfStakeWei) / WEI) +
        Number(BigInt(curr.selfStakeWei) % WEI) / Number(WEI);
      let baseline = lastVal;
      if (baseline == null && prev.selfStakeWei != null) {
        baseline =
          Number(BigInt(prev.selfStakeWei) / WEI) +
          Number(BigInt(prev.selfStakeWei) % WEI) / Number(WEI);
      }
      if (baseline == null) {
        return { shouldFire: false, reason: "no baseline", message: "" };
      }
      const delta = Math.abs(currMon - baseline);
      if (delta >= threshold) {
        return {
          shouldFire: true,
          reason: "self-stake moved",
          oldValue: baseline,
          newValue: currMon,
          message: `Self-stake ${baseline.toFixed(0)} → ${currMon.toFixed(0)} MON (Δ ${delta.toFixed(0)}) at epoch ${curr.epoch}`,
        };
      }
      return {
        shouldFire: false,
        reason: `Δ ${delta.toFixed(0)} MON < ${threshold}`,
        message: "",
      };
    }

    case "missed_blocks": {
      // Production efficiency = actualBlocks / expectedBlocks for the
      // most recent epoch the indexer has covered.
      const eff = await computeProductionEfficiency(rule.validatorId, curr);
      if (eff == null) {
        return {
          shouldFire: false,
          reason: "no production data for this epoch",
          message: "",
        };
      }
      if (eff < threshold) {
        return {
          shouldFire: true,
          reason: "production efficiency below threshold",
          oldValue: lastVal,
          newValue: eff,
          message: `Production efficiency ${(eff * 100).toFixed(1)}% < threshold ${(threshold * 100).toFixed(1)}% at epoch ${curr.epoch}`,
        };
      }
      return {
        shouldFire: false,
        reason: `eff ${(eff * 100).toFixed(1)}% ≥ ${(threshold * 100).toFixed(1)}%`,
        message: "",
      };
    }

    case "apy_drop": {
      // Pool APY = pool_rewards_per_epoch / stake × EPOCHS_PER_YEAR × 100.
      const apy = computePoolApySingleEpoch(curr, prev);
      if (apy == null) {
        return { shouldFire: false, reason: "cannot compute APY", message: "" };
      }
      if (lastVal == null) {
        // First evaluation — store the baseline, don't fire.
        return {
          shouldFire: false,
          reason: "baseline established",
          newValue: apy,
          message: "",
        };
      }
      const delta = lastVal - apy;
      if (delta >= threshold) {
        return {
          shouldFire: true,
          reason: "APY dropped",
          oldValue: lastVal,
          newValue: apy,
          message: `Pool APY ${lastVal.toFixed(2)}% → ${apy.toFixed(2)}% (drop ${delta.toFixed(2)}pp) at epoch ${curr.epoch}`,
        };
      }
      return {
        shouldFire: false,
        reason: `drop ${delta.toFixed(2)}pp < ${threshold}pp`,
        message: "",
      };
    }
  }

  return { shouldFire: false, reason: "unknown kind", message: "" };
}

function computePoolApySingleEpoch(
  curr: SnapshotRow,
  prev: SnapshotRow,
): number | null {
  const EPOCHS_PER_YEAR = 4.36 * 365;
  try {
    const prevAcc = BigInt(prev.accRewardPerToken);
    const currAcc = BigInt(curr.accRewardPerToken);
    const stakeWei = BigInt(prev.stakeWei);
    if (stakeWei === BigInt(0)) return null;
    const RATIO = BigInt(10) ** BigInt(36);
    const yieldScaled = ((currAcc - prevAcc) * RATIO) / stakeWei;
    const yieldPerEpoch = Number(yieldScaled) / Number(RATIO);
    const epochSpan = curr.epoch - prev.epoch || 1;
    const perEpoch = yieldPerEpoch / epochSpan;
    return perEpoch * EPOCHS_PER_YEAR * 100;
  } catch {
    return null;
  }
}

async function computeProductionEfficiency(
  validatorId: number,
  curr: SnapshotRow,
): Promise<number | null> {
  // Sum blocks proposed by all miner_addresses mapped to this validator
  // for the current epoch.
  const valBlockRows = (await db
    .select({
      blocks: sql<number>`SUM(${epochPriorityFees.blocksProposed})`,
    })
    .from(epochPriorityFees)
    .innerJoin(
      minerAliases,
      eq(minerAliases.minerAddress, epochPriorityFees.minerAddress),
    )
    .where(
      and(
        eq(minerAliases.validatorId, validatorId),
        eq(epochPriorityFees.epoch, curr.epoch),
      ),
    )) as unknown as { blocks: number | null }[];
  const actualBlocks = Number(valBlockRows[0]?.blocks ?? 0);

  const totalRows = (await db
    .select({
      total: sql<number>`SUM(${epochPriorityFees.blocksProposed})`,
    })
    .from(epochPriorityFees)
    .where(eq(epochPriorityFees.epoch, curr.epoch))) as unknown as {
    total: number | null;
  }[];
  const totalBlocks = Number(totalRows[0]?.total ?? 0);
  if (totalBlocks === 0) return null;

  const stakeRows = (await db
    .select({
      total: sql<string>`SUM(CAST(${epochSnapshots.stakeWei} AS NUMERIC))::TEXT`,
    })
    .from(epochSnapshots)
    .where(eq(epochSnapshots.epoch, curr.epoch))) as unknown as {
    total: string | null;
  }[];
  const totalStakeWei = BigInt(stakeRows[0]?.total ?? "0");
  const myStakeWei = BigInt(curr.stakeWei);
  if (totalStakeWei === BigInt(0)) return null;

  const RATIO = BigInt(10) ** BigInt(18);
  const shareScaled = (myStakeWei * RATIO) / totalStakeWei;
  const share = Number(shareScaled) / Number(RATIO);
  const expected = totalBlocks * share;
  if (expected <= 0) return null;
  return actualBlocks / expected;
}

async function deliverWebhook(
  url: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // Discord webhooks accept a `content` field; Slack accepts `text`.
    // Send a generic JSON body plus those convenience fields so the same
    // URL works in either platform without per-target config.
    const text = `[Monad alert] ${payload.message}`;
    const body = JSON.stringify({
      ...payload,
      content: text,
      text,
    });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      return { ok: false, error: `webhook ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
