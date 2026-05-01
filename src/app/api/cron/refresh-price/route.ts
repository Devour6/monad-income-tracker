import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { networkEpochs } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { refreshLiveMonPrice } from "@/lib/price";

/**
 * GET /api/cron/refresh-price
 *
 * Pulls a fresh MON price from the multi-source price layer and stamps it
 * onto the latest `network_epochs` row. Every USD figure across the app
 * (network overview, validator income tables, charts, simulator, reports,
 * MEV page) reads the latest stored price, so refreshing this row keeps
 * the entire surface current within the cron interval.
 *
 * If no epoch row exists yet for the most recent epoch, we update the
 * latest existing row anyway — the snapshot cron will create new ones
 * daily and this cron will keep filling them in between.
 *
 * Auth: optional Bearer CRON_SECRET. Without it, anyone can trigger a
 * refresh — no harm, the price layer is rate-limit-aware via in-memory
 * cache.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization") || "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const t0 = Date.now();
  const result = await refreshLiveMonPrice();

  if (!result.price || result.price <= 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "All price sources failed",
        attempts: result.attempts,
        durationMs: Date.now() - t0,
      },
      { status: 503 }
    );
  }

  // Update the latest network_epochs row with the fresh price.
  const [latest] = await db
    .select()
    .from(networkEpochs)
    .orderBy(desc(networkEpochs.epoch))
    .limit(1);

  let updated = false;
  let touchedEpoch: number | null = null;
  if (latest) {
    await db
      .update(networkEpochs)
      .set({ monPriceUsd: result.price.toFixed(8) })
      .where(eq(networkEpochs.epoch, latest.epoch));
    updated = true;
    touchedEpoch = latest.epoch;
  }

  return NextResponse.json({
    ok: true,
    price: result.price,
    source: result.source,
    ageMs: result.ageMs,
    updatedDb: updated,
    epoch: touchedEpoch,
    attempts: result.attempts,
    durationMs: Date.now() - t0,
  });
}
