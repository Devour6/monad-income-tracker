import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { networkEpochs, epochSnapshots } from "@/lib/db/schema";
import { sql, asc, desc, inArray } from "drizzle-orm";

/**
 * POST /api/admin/backfill-prices
 *
 * One-time historical price backfill. For every epoch we have snapshots for
 * but no `network_epochs.mon_price_usd` entry yet, fetch the daily MON/USD
 * close from CoinGecko's market_chart endpoint and insert.
 *
 * Why this is needed: snapshots cron only stamps a price for the latest
 * epoch. Historical epochs (1302-1436) have no price stored, so the
 * "Historical" FX toggle on the dashboard falls back to live price for
 * those rows. After this backfill runs, per-epoch USD valuations are real.
 *
 * Auth: requires `Authorization: Bearer $CRON_SECRET`.
 *
 * Source: CoinGecko free /api/v3/coins/monad/market_chart?vs_currency=usd&days=N
 *   returns [[ts_ms, price], ...] at daily granularity for days > 90.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Earliest snapshot timestamp anchors the date range.
    const [earliest] = await db
      .select()
      .from(epochSnapshots)
      .orderBy(asc(epochSnapshots.epoch))
      .limit(1);
    const [latest] = await db
      .select()
      .from(epochSnapshots)
      .orderBy(desc(epochSnapshots.epoch))
      .limit(1);

    if (!earliest || !latest) {
      return NextResponse.json({ error: "No snapshots" }, { status: 404 });
    }

    // Latest snapshot's createdAt is the real chain time anchor; projecting
    // backwards at 4.36 epochs/day gives each historical epoch a timestamp.
    const EPOCHS_PER_DAY = 4.36;
    const MS_PER_DAY = 86_400_000;
    const anchorEpoch = latest.epoch;
    const anchorMs = latest.createdAt.getTime();
    const epochToMs = (e: number): number =>
      anchorMs - ((anchorEpoch - e) / EPOCHS_PER_DAY) * MS_PER_DAY;

    // Distinct epochs we have snapshots for.
    const allEpochsRows = (await db
      .selectDistinct({ epoch: epochSnapshots.epoch })
      .from(epochSnapshots)
      .orderBy(asc(epochSnapshots.epoch))) as { epoch: number }[];
    const allEpochs = allEpochsRows.map((r) => r.epoch);

    // Existing network_epochs price coverage.
    const existing = await db
      .select()
      .from(networkEpochs)
      .where(inArray(networkEpochs.epoch, allEpochs));
    const haveGoodPrice = new Set<number>();
    for (const r of existing) {
      const p = Number(r.monPriceUsd) || 0;
      if (p > 0) haveGoodPrice.add(r.epoch);
    }

    const missing = allEpochs.filter((e) => !haveGoodPrice.has(e));
    if (missing.length === 0) {
      return NextResponse.json({
        backfilled: 0,
        existing: haveGoodPrice.size,
        message: "All epochs already have prices.",
      });
    }

    // Fetch CoinGecko market chart — daily granularity for days > 90.
    // Compute days range from earliest missing to today.
    const earliestMissingMs = epochToMs(missing[0]);
    const daysSpan = Math.ceil(
      (Date.now() - earliestMissingMs) / MS_PER_DAY
    ) + 2;
    const days = Math.min(Math.max(daysSpan, 30), 365);

    const cgUrl = `https://api.coingecko.com/api/v3/coins/monad/market_chart?vs_currency=usd&days=${days}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    let priceSeries: Array<[number, number]> = [];
    try {
      const res = await fetch(cgUrl, { signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) {
        return NextResponse.json(
          { error: `CoinGecko ${res.status}` },
          { status: 502 }
        );
      }
      const data = (await res.json()) as { prices?: Array<[number, number]> };
      priceSeries = data.prices ?? [];
    } finally {
      clearTimeout(t);
    }

    if (priceSeries.length === 0) {
      return NextResponse.json(
        { error: "CoinGecko returned no prices" },
        { status: 502 }
      );
    }

    // For each missing epoch, find the closest CoinGecko sample by timestamp
    // and upsert into network_epochs.
    function priceAt(targetMs: number): number {
      let lo = 0;
      let hi = priceSeries.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (priceSeries[mid][0] < targetMs) lo = mid + 1;
        else hi = mid;
      }
      const cand = [
        priceSeries[Math.max(0, lo - 1)],
        priceSeries[lo],
        priceSeries[Math.min(priceSeries.length - 1, lo + 1)],
      ];
      let best = cand[0];
      let bestDelta = Math.abs(best[0] - targetMs);
      for (const c of cand) {
        const d = Math.abs(c[0] - targetMs);
        if (d < bestDelta) {
          best = c;
          bestDelta = d;
        }
      }
      return best[1];
    }

    let backfilled = 0;
    let skipped = 0;
    for (const epoch of missing) {
      const ms = epochToMs(epoch);
      const price = priceAt(ms);
      if (!isFinite(price) || price <= 0) {
        skipped++;
        continue;
      }
      await db
        .insert(networkEpochs)
        .values({
          epoch,
          monPriceUsd: price.toFixed(8),
        })
        .onConflictDoUpdate({
          target: networkEpochs.epoch,
          set: { monPriceUsd: price.toFixed(8) },
        });
      backfilled++;
    }

    return NextResponse.json({
      backfilled,
      skipped,
      existing: haveGoodPrice.size,
      total: allEpochs.length,
      coingeckoSamples: priceSeries.length,
      daysFetched: days,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
