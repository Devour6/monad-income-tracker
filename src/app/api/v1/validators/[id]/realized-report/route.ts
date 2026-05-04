import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  validators,
  networkEpochs,
  epochPriorityFees,
  minerAliases,
  epochSnapshots,
} from "@/lib/db/schema";
import { claimEvents } from "@/lib/db/claim-events-schema";
import { and, asc, eq, gte, inArray, lte, sql, desc } from "drizzle-orm";
import { getLiveMonPrice } from "@/lib/price";

/**
 * GET /api/v1/validators/[id]/realized-report
 *
 * Income tracker, not income model. Each row in the response corresponds to
 * a real on-chain ClaimRewards event the validator has signed. Summary
 * totals = sum(claim amounts) + currently unclaimed.
 *
 * No accumulator math, no commission rate × pool projection. Just claim
 * transactions filtered by validator and (optionally) date window.
 *
 * Query params:
 *   format=json|csv               — default json
 *   fromDate=ISO  toDate=ISO      — optional window restriction (block_timestamp)
 *   fx=per-epoch|end-of-period    — FX methodology (default per-epoch)
 *   serverCostUsd=N               — monthly USD operating cost, prorated
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const validatorId = parseInt(id, 10);
  if (!Number.isFinite(validatorId)) {
    return NextResponse.json({ error: "Invalid validator ID" }, { status: 400 });
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const fx =
    url.searchParams.get("fx") === "end-of-period"
      ? "end-of-period"
      : "per-epoch";
  const serverCostMonthlyUsd = Math.max(
    0,
    Number(url.searchParams.get("serverCostUsd") || "0") || 0
  );
  const fromDate = url.searchParams.get("fromDate");
  const toDate = url.searchParams.get("toDate");

  try {
    const [meta] = await db
      .select()
      .from(validators)
      .where(eq(validators.validatorId, validatorId))
      .limit(1);

    if (!meta) {
      return NextResponse.json({ error: "Validator not found" }, { status: 404 });
    }

    const auth = meta.authAddress.toLowerCase();

    // 1. Build claim_events filter.
    const conds = [
      eq(claimEvents.validatorId, validatorId),
      eq(claimEvents.delegator, auth),
    ];
    if (fromDate) {
      const t = new Date(fromDate);
      if (!Number.isNaN(t.getTime())) {
        conds.push(gte(claimEvents.blockTimestamp, t));
      }
    }
    if (toDate) {
      const t = new Date(toDate);
      if (!Number.isNaN(t.getTime())) {
        // make `to` inclusive of the entire day
        t.setHours(23, 59, 59, 999);
        conds.push(lte(claimEvents.blockTimestamp, t));
      }
    }

    // 2. Pull every claim event in the window.
    const claims = await db
      .select({
        blockNumber: claimEvents.blockNumber,
        blockTimestamp: claimEvents.blockTimestamp,
        amountWei: claimEvents.amountWei,
        epoch: claimEvents.epoch,
        txHash: claimEvents.txHash,
      })
      .from(claimEvents)
      .where(and(...conds))
      .orderBy(asc(claimEvents.blockNumber));

    const WEI = BigInt(10) ** BigInt(18);
    const toMon = (wei: bigint) =>
      Number(wei / WEI) + Number(wei % WEI) / Number(WEI);

    // 3. Latest unclaimed balance from snapshots — counted toward total
    //    only when window is "all time" (no date filter). For date-bound
    //    windows we report exact in-window claims plus a separate
    //    `currentUnclaimedMon` field for context.
    const snapAggRows = (await db
      .select({
        cnt: sql<number>`COUNT(*)::int`,
        minE: sql<number | null>`MIN(${epochSnapshots.epoch})`,
        maxE: sql<number | null>`MAX(${epochSnapshots.epoch})`,
        firstTs: sql<Date | null>`MIN(${epochSnapshots.createdAt})`,
        lastTs: sql<Date | null>`MAX(${epochSnapshots.createdAt})`,
      })
      .from(epochSnapshots)
      .where(eq(epochSnapshots.validatorId, validatorId))) as unknown as {
      cnt: number;
      minE: number | null;
      maxE: number | null;
      firstTs: Date | null;
      lastTs: Date | null;
    }[];
    const snapAgg = snapAggRows[0];

    const latestSnapRow = await db
      .select({ unclaimed: epochSnapshots.unclaimedRewards })
      .from(epochSnapshots)
      .where(eq(epochSnapshots.validatorId, validatorId))
      .orderBy(desc(epochSnapshots.epoch))
      .limit(1);
    const currentUnclaimedWei =
      latestSnapRow.length > 0 ? BigInt(latestSnapRow[0].unclaimed) : BigInt(0);
    const currentUnclaimedMon = toMon(currentUnclaimedWei);

    // 4. Window summary.
    let totalClaimedWei = BigInt(0);
    for (const c of claims) {
      totalClaimedWei += BigInt(c.amountWei);
    }
    const totalClaimedMon = toMon(totalClaimedWei);

    const isFullWindow = !fromDate && !toDate;
    // For "all time" the lifetime commission = totalClaimed + currentUnclaimed.
    // For a sliced window we report only the claimed amounts that fell in
    // the window — adding currentUnclaimed there would mix windows.
    const totalIncomeMon = isFullWindow
      ? totalClaimedMon + currentUnclaimedMon
      : totalClaimedMon;

    // 5. Window timestamps.
    const firstTs = claims.length > 0 ? claims[0].blockTimestamp : null;
    const lastTs =
      claims.length > 0 ? claims[claims.length - 1].blockTimestamp : null;
    const daysObserved =
      firstTs && lastTs
        ? Math.max(
            0,
            (lastTs.getTime() - firstTs.getTime()) / 86_400_000
          )
        : 0;

    // 6. Historical price map for per-epoch FX. Use the epoch each claim
    //    landed in for `per-epoch` FX; live price for `end-of-period`.
    const epochsInWindow = Array.from(
      new Set(claims.map((c) => c.epoch))
    );
    const priceRows =
      epochsInWindow.length > 0
        ? await db
            .select()
            .from(networkEpochs)
            .where(inArray(networkEpochs.epoch, epochsInWindow))
        : [];
    const priceMap = new Map<number, number>();
    for (const r of priceRows) {
      priceMap.set(r.epoch, Number(r.monPriceUsd) || 0);
    }
    const live = await getLiveMonPrice().catch(() => ({ price: 0 }));
    const livePrice = (live as { price: number }).price || 0;
    const endOfPeriodPrice =
      claims.length > 0 ? priceMap.get(claims[claims.length - 1].epoch) || livePrice : livePrice;

    // 7. Priority fees in the same window (best-effort).
    let priorityFeesMon = 0;
    let priorityFeesUsd = 0;
    if (snapAgg && snapAgg.minE != null && snapAgg.maxE != null) {
      // Convert claim window to epoch bounds (best-effort: span first→last claim).
      let pfFromEpoch = snapAgg.minE;
      let pfToEpoch = snapAgg.maxE;
      if (claims.length > 0) {
        pfFromEpoch = claims[0].epoch;
        pfToEpoch = claims[claims.length - 1].epoch;
      }
      const pfRows = (await db
        .select({
          epoch: epochPriorityFees.epoch,
          feesWei: sql<string>`SUM(CAST(${epochPriorityFees.priorityFeesWei} AS NUMERIC))::TEXT`,
        })
        .from(epochPriorityFees)
        .innerJoin(
          minerAliases,
          eq(minerAliases.minerAddress, epochPriorityFees.minerAddress)
        )
        .where(
          and(
            eq(minerAliases.validatorId, validatorId),
            gte(epochPriorityFees.epoch, pfFromEpoch),
            lte(epochPriorityFees.epoch, pfToEpoch)
          )
        )
        .groupBy(epochPriorityFees.epoch)) as unknown as {
        epoch: number;
        feesWei: string;
      }[];
      for (const r of pfRows) {
        const wei = BigInt(r.feesWei || "0");
        const feesMon = toMon(wei);
        priorityFeesMon += feesMon;
        const fxPrice =
          fx === "end-of-period"
            ? endOfPeriodPrice
            : priceMap.get(r.epoch) || livePrice;
        priorityFeesUsd += feesMon * fxPrice;
      }
    }

    // 8. Per-claim USD valuations.
    const claimRows = claims.map((c) => {
      const amountMon = toMon(BigInt(c.amountWei));
      const fxPrice =
        fx === "end-of-period"
          ? endOfPeriodPrice
          : priceMap.get(c.epoch) || livePrice;
      return {
        blockNumber: c.blockNumber.toString(),
        timestamp: c.blockTimestamp.toISOString(),
        epoch: c.epoch,
        amountMon,
        amountUsd: amountMon * fxPrice,
        fxPriceUsd: fxPrice,
        txHash: c.txHash,
      };
    });

    const totalCommissionUsd = claimRows.reduce(
      (s, r) => s + r.amountUsd,
      0
    );

    // Legacy `epochs` array for the dashboard's per-epoch table + chart.
    // We synthesize it by grouping claims by epoch — every epoch with one or
    // more claims becomes a row. Epochs with no claims simply don't appear,
    // which is correct: the validator earned no realized income in those
    // epochs (only unrealized accumulator growth, which we deliberately do
    // not project).
    interface LegacyEpochRow {
      epoch: number;
      timestamp: string;
      stakeMon: number;
      commissionPct: number;
      commissionMon: number;
      claimedMon: number;
      priorityFeesMon: number;
      fxPriceUsd: number;
      commissionUsd: number;
      priorityFeesUsd: number;
      unclaimedMon: number;
    }
    const epochRowsMap = new Map<number, LegacyEpochRow>();
    for (const r of claimRows) {
      const existing = epochRowsMap.get(r.epoch);
      if (existing) {
        existing.commissionMon += r.amountMon;
        existing.commissionUsd += r.amountUsd;
        existing.claimedMon += r.amountMon;
      } else {
        epochRowsMap.set(r.epoch, {
          epoch: r.epoch,
          timestamp: r.timestamp,
          stakeMon: meta.stakeMon ? Number(meta.stakeMon) : 0,
          commissionPct: meta.commissionPct ? Number(meta.commissionPct) : 0,
          commissionMon: r.amountMon,
          claimedMon: r.amountMon,
          priorityFeesMon: 0,
          fxPriceUsd: r.fxPriceUsd,
          commissionUsd: r.amountUsd,
          priorityFeesUsd: 0,
          unclaimedMon: 0,
        });
      }
    }
    const epochsArray = Array.from(epochRowsMap.values()).sort(
      (a, b) => a.epoch - b.epoch
    );

    // 9. Server cost pro-rated over claim-window days.
    const serverCostProRatedUsd =
      (serverCostMonthlyUsd / 30) * Math.max(0, daysObserved);
    // Mirror the totalIncomeMon formula: lifetime view includes currentUnclaimed,
    // sliced windows do not (they'd mix periods).
    const totalIncomeUsd =
      totalCommissionUsd +
      priorityFeesUsd +
      (isFullWindow ? currentUnclaimedMon * livePrice : 0);
    const netUsd = totalIncomeUsd - serverCostProRatedUsd;

    const summary = {
      claimCount: claims.length,
      commissionMon: totalClaimedMon,
      commissionUsd: totalCommissionUsd,
      priorityFeesMon,
      priorityFeesUsd,
      // Legacy aliases for the existing dashboard UI:
      // - `claimedMon`  = total MON claimed in the window (same as commissionMon).
      // - `unclaimedMon` = currently unclaimed (same as currentUnclaimedMon).
      claimedMon: totalClaimedMon,
      unclaimedMon: currentUnclaimedMon,
      currentUnclaimedMon,
      currentUnclaimedUsd: currentUnclaimedMon * livePrice,
      totalIncomeMon,
      totalIncomeUsd,
      serverCostMonthlyUsd,
      serverCostProRatedUsd,
      netUsd,
      fxMethodology: fx,
      endOfPeriodPriceUsd: endOfPeriodPrice,
      livePriceUsd: livePrice,
      isFullWindow,
    };

    if (format === "csv") {
      const validatorName = meta.name || `Validator #${validatorId}`;
      const lines: string[] = [];
      lines.push(`# Monad Validator Income Report — Real on-chain claims`);
      lines.push(`# Validator: ${validatorName} (#${validatorId})`);
      lines.push(`# Auth: ${meta.authAddress}`);
      lines.push(
        `# Window: ${firstTs ? firstTs.toISOString() : "(no claims)"} → ${
          lastTs ? lastTs.toISOString() : "(no claims)"
        }`
      );
      lines.push(`# Days observed: ${daysObserved.toFixed(2)}`);
      lines.push(`# Claim count: ${claims.length}`);
      lines.push(`# FX: ${fx}`);
      lines.push(``);
      lines.push(
        [
          "block_number",
          "timestamp",
          "epoch",
          "amount_mon",
          "fx_price_usd",
          "amount_usd",
          "tx_hash",
        ].join(",")
      );
      for (const r of claimRows) {
        lines.push(
          [
            r.blockNumber,
            r.timestamp,
            r.epoch,
            r.amountMon,
            r.fxPriceUsd,
            r.amountUsd,
            r.txHash,
          ].join(",")
        );
      }
      lines.push(``);
      lines.push(`# Summary`);
      lines.push(`# Claimed (window) MON: ${summary.commissionMon}`);
      lines.push(`# Claimed (window) USD: ${summary.commissionUsd}`);
      lines.push(`# Priority fees MON: ${summary.priorityFeesMon}`);
      lines.push(`# Priority fees USD: ${summary.priorityFeesUsd}`);
      lines.push(`# Currently unclaimed MON: ${summary.currentUnclaimedMon}`);
      lines.push(`# Total income MON: ${summary.totalIncomeMon}`);
      lines.push(`# Total income USD: ${summary.totalIncomeUsd}`);
      lines.push(`# Server cost USD (prorated): ${summary.serverCostProRatedUsd}`);
      lines.push(`# Net USD: ${summary.netUsd}`);

      return new NextResponse(lines.join("\n"), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="validator-${validatorId}-income.csv"`,
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
        },
      });
    }

    const response = NextResponse.json({
      validatorId,
      validator: {
        validatorId: meta.validatorId,
        name: meta.name,
        authAddress: meta.authAddress,
        commissionPct: meta.commissionPct ? Number(meta.commissionPct) : 0,
        stakeMon: meta.stakeMon ? Number(meta.stakeMon) : 0,
      },
      window: {
        firstTimestamp: firstTs ? firstTs.toISOString() : null,
        lastTimestamp: lastTs ? lastTs.toISOString() : null,
        daysObserved,
        snapshotFirstEpoch: snapAgg?.minE ?? null,
        snapshotLastEpoch: snapAgg?.maxE ?? null,
      },
      summary,
      claims: claimRows,
      // Legacy field consumed by the dashboard's per-epoch chart + table.
      // Each entry corresponds to one or more claim events in that epoch.
      epochs: epochsArray,
      claimEvents: claimRows.map((r) => ({
        epoch: r.epoch,
        timestamp: r.timestamp,
        amountMon: r.amountMon,
        amountUsd: r.amountUsd,
        txHash: r.txHash,
      })),
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300"
    );
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
