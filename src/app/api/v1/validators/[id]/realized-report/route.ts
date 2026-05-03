import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  epochSnapshots,
  networkEpochs,
  validators,
  epochPriorityFees,
  minerAliases,
} from "@/lib/db/schema";
import { eq, asc, inArray, sql, gte, lte, and } from "drizzle-orm";
import { getLiveMonPrice } from "@/lib/price";

/**
 * GET /api/v1/validators/[id]/realized-report
 *
 * Accounting-grade income report using REALIZED commission math
 * (unclaimed_rewards delta + claim detection — the only math that matches
 * treasury ground truth, validated to 0.04% against CFO records).
 *
 * Replaces the legacy /api/validators/[id]/report which used the broken
 * pool×rate estimate.
 *
 * Query params:
 *   format=json|csv               — default json
 *   fromDate=ISO  toDate=ISO      — optional window restriction
 *   fromEpoch=N   toEpoch=N       — alternative window restriction
 *   fx=per-epoch|end-of-period    — FX methodology (default per-epoch)
 *   serverCostUsd=N               — monthly USD operating cost, prorated
 *
 * Output (json):
 *   validator:    {id, name, authAddress, commissionPct, stakeMon}
 *   window:       {fromEpoch, toEpoch, epochSpan, days, firstTs, lastTs}
 *   summary:      {commissionMon, commissionUsd, priorityFeesMon, priorityFeesUsd,
 *                  totalIncomeMon, totalIncomeUsd, claimedMon, unclaimedMon,
 *                  serverCostUsd, netUsd}
 *   epochs:       [{epoch, ts, unclaimedMon, accruedMon, claimedMon,
 *                   priorityFeesMon, fxPriceUsd, ...}]
 *   claimEvents:  [{epoch, ts, amountMon, amountUsd}]
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

  const fromEpochParam = url.searchParams.get("fromEpoch");
  const toEpochParam = url.searchParams.get("toEpoch");
  const fromDate = url.searchParams.get("fromDate");
  const toDate = url.searchParams.get("toDate");

  try {
    const [meta] = await db
      .select()
      .from(validators)
      .where(eq(validators.validatorId, validatorId))
      .limit(1);

    // Pull every snapshot we have for this validator. Window filtering is
    // applied after we fetch so we can correctly compute the delta against
    // the snapshot just BEFORE the window.
    const allSnaps = await db
      .select()
      .from(epochSnapshots)
      .where(eq(epochSnapshots.validatorId, validatorId))
      .orderBy(asc(epochSnapshots.epoch));

    if (allSnaps.length < 2) {
      return NextResponse.json({
        validatorId,
        validator: meta ?? null,
        window: null,
        summary: null,
        epochs: [],
        claimEvents: [],
        note: "Insufficient snapshots.",
      });
    }

    // Determine window
    let windowFromEpoch = fromEpochParam ? parseInt(fromEpochParam, 10) : null;
    let windowToEpoch = toEpochParam ? parseInt(toEpochParam, 10) : null;
    if (fromDate || toDate) {
      // Translate dates → epochs by snapshot timestamp.
      if (fromDate) {
        const t = new Date(fromDate).getTime();
        const match = allSnaps.find((s) => s.createdAt.getTime() >= t);
        if (match) windowFromEpoch = windowFromEpoch ?? match.epoch;
      }
      if (toDate) {
        const t = new Date(toDate).getTime();
        const match = [...allSnaps]
          .reverse()
          .find((s) => s.createdAt.getTime() <= t);
        if (match) windowToEpoch = windowToEpoch ?? match.epoch;
      }
    }
    if (windowFromEpoch == null) windowFromEpoch = allSnaps[0].epoch;
    if (windowToEpoch == null)
      windowToEpoch = allSnaps[allSnaps.length - 1].epoch;

    // Snapshots inside the window, plus the one immediately before so we
    // have a baseline for the first delta.
    const inWindow = allSnaps.filter(
      (s) => s.epoch >= windowFromEpoch! && s.epoch <= windowToEpoch!
    );
    const baselineIdx =
      allSnaps.findIndex((s) => s.epoch >= windowFromEpoch!) - 1;
    const baseline = baselineIdx >= 0 ? allSnaps[baselineIdx] : null;

    if (inWindow.length === 0) {
      return NextResponse.json({
        validatorId,
        validator: meta ?? null,
        window: { fromEpoch: windowFromEpoch, toEpoch: windowToEpoch },
        summary: null,
        epochs: [],
        claimEvents: [],
        note: "No snapshots in window.",
      });
    }

    // Historical price map for per-epoch FX.
    const epochIds = inWindow.map((s) => s.epoch);
    const priceRows = await db
      .select()
      .from(networkEpochs)
      .where(inArray(networkEpochs.epoch, epochIds));
    const priceMap = new Map<number, number>();
    for (const r of priceRows) {
      priceMap.set(r.epoch, Number(r.monPriceUsd) || 0);
    }

    // Live price — used as fallback when historical price is missing/zero,
    // and as the end-of-period FX rate.
    const live = await getLiveMonPrice().catch(() => ({ price: 0 }));
    const livePrice = (live as { price: number }).price || 0;
    const endOfPeriodPrice =
      priceMap.get(windowToEpoch!) || livePrice || 0;

    // Priority fees per epoch attributed to this validator (best-effort).
    const pfRows = (await db
      .select({
        epoch: epochPriorityFees.epoch,
        feesWei: sql<string>`SUM(CAST(${epochPriorityFees.priorityFeesWei} AS NUMERIC))::TEXT`,
        blocks: sql<number>`SUM(${epochPriorityFees.blocksProposed})`,
      })
      .from(epochPriorityFees)
      .innerJoin(
        minerAliases,
        eq(minerAliases.minerAddress, epochPriorityFees.minerAddress)
      )
      .where(
        and(
          eq(minerAliases.validatorId, validatorId),
          inArray(epochPriorityFees.epoch, epochIds)
        )
      )
      .groupBy(epochPriorityFees.epoch)) as unknown as {
      epoch: number;
      feesWei: string;
      blocks: number;
    }[];

    const WEI = BigInt(10) ** BigInt(18);
    const toMon = (wei: bigint) =>
      Number(wei / WEI) + Number(wei % WEI) / Number(WEI);
    const pfMap = new Map<number, { feesMon: number; blocks: number }>();
    for (const r of pfRows) {
      pfMap.set(r.epoch, {
        feesMon: toMon(BigInt(r.feesWei || "0")),
        blocks: Number(r.blocks || 0),
      });
    }

    // Walk window snapshots, computing per-epoch realized commission
    // accrual + claim detection using the validator's `unclaimed_rewards`
    // accumulator. Identical math to /realized but on a sliced window.
    const epochs: Array<{
      epoch: number;
      timestamp: string;
      stakeMon: number;
      commissionPct: number;
      unclaimedMon: number;
      // commission accrued during this epoch span (incremental)
      commissionMon: number;
      // claim detected at this epoch (if any)
      claimedMon: number;
      // priority fees attributed to this validator
      priorityFeesMon: number;
      priorityFeeBlocks: number;
      // FX
      fxPriceUsd: number;
      commissionUsd: number;
      priorityFeesUsd: number;
    }> = [];

    let summaryCommissionMon = 0;
    let summaryClaimedMon = 0;
    let summaryPriorityFeesMon = 0;
    let summaryCommissionUsd = 0;
    let summaryPriorityFeesUsd = 0;

    const claimEvents: Array<{
      epoch: number;
      timestamp: string;
      amountMon: number;
      amountUsd: number;
    }> = [];

    let prevUnclaimed = baseline ? toMon(BigInt(baseline.unclaimedRewards)) : 0;

    for (const s of inWindow) {
      const currUnclaimed = toMon(BigInt(s.unclaimedRewards));
      let commissionMon = 0;
      let claimedMon = 0;
      if (currUnclaimed >= prevUnclaimed - 1) {
        // pure accrual (or noise-level drop within 1 MON tolerance)
        commissionMon = Math.max(0, currUnclaimed - prevUnclaimed);
      } else {
        // Claim detected. Commission earned this epoch =
        // (drop) + (any growth above zero in curr) — but we don't have
        // intra-epoch resolution, so attribute the drop as claimed and
        // currUnclaimed as new accrual.
        claimedMon = prevUnclaimed - currUnclaimed;
        commissionMon = claimedMon + currUnclaimed;
      }

      const stakeMon =
        toMon(BigInt(s.stakeWei));
      const commissionPctRaw = Number(BigInt(s.commission)) / 1e18;

      const pf = pfMap.get(s.epoch);
      const priorityFeesMon = pf?.feesMon ?? 0;
      const priorityFeeBlocks = pf?.blocks ?? 0;

      // FX selection
      const histPrice = priceMap.get(s.epoch) ?? 0;
      const fxPrice =
        fx === "end-of-period"
          ? endOfPeriodPrice
          : histPrice > 0
            ? histPrice
            : livePrice;

      const commissionUsd = commissionMon * fxPrice;
      const priorityFeesUsd = priorityFeesMon * fxPrice;

      epochs.push({
        epoch: s.epoch,
        timestamp: s.createdAt.toISOString(),
        stakeMon,
        commissionPct: commissionPctRaw * 100,
        unclaimedMon: currUnclaimed,
        commissionMon,
        claimedMon,
        priorityFeesMon,
        priorityFeeBlocks,
        fxPriceUsd: fxPrice,
        commissionUsd,
        priorityFeesUsd,
      });

      summaryCommissionMon += commissionMon;
      summaryClaimedMon += claimedMon;
      summaryPriorityFeesMon += priorityFeesMon;
      summaryCommissionUsd += commissionUsd;
      summaryPriorityFeesUsd += priorityFeesUsd;

      if (claimedMon > 0) {
        claimEvents.push({
          epoch: s.epoch,
          timestamp: s.createdAt.toISOString(),
          amountMon: claimedMon,
          amountUsd: claimedMon * fxPrice,
        });
      }

      prevUnclaimed = currUnclaimed;
    }

    const firstTs = inWindow[0].createdAt;
    const lastTs = inWindow[inWindow.length - 1].createdAt;
    const epochSpan = inWindow[inWindow.length - 1].epoch - inWindow[0].epoch;
    const daysObserved = epochSpan / 4.36;

    // Server cost — pro-rated over the observed window
    const serverCostProRatedUsd =
      (serverCostMonthlyUsd / 30) * Math.max(0, daysObserved);

    const totalIncomeMon = summaryCommissionMon + summaryPriorityFeesMon;
    const totalIncomeUsd = summaryCommissionUsd + summaryPriorityFeesUsd;
    const netUsd = totalIncomeUsd - serverCostProRatedUsd;

    const summary = {
      commissionMon: summaryCommissionMon,
      commissionUsd: summaryCommissionUsd,
      priorityFeesMon: summaryPriorityFeesMon,
      priorityFeesUsd: summaryPriorityFeesUsd,
      totalIncomeMon,
      totalIncomeUsd,
      claimedMon: summaryClaimedMon,
      unclaimedMon:
        epochs.length > 0 ? epochs[epochs.length - 1].unclaimedMon : 0,
      serverCostMonthlyUsd,
      serverCostProRatedUsd,
      netUsd,
      fxMethodology: fx,
      endOfPeriodPriceUsd: endOfPeriodPrice,
      livePriceUsd: livePrice,
    };

    if (format === "csv") {
      // CSV with header rows + summary footer.
      const validatorName = meta?.name || `Validator #${validatorId}`;
      const lines: string[] = [];
      lines.push(`# Monad Validator Income Report (Realized)`);
      lines.push(`# Validator: ${validatorName} (#${validatorId})`);
      lines.push(`# Auth: ${meta?.authAddress ?? ""}`);
      lines.push(
        `# Window: epochs ${inWindow[0].epoch}-${inWindow[inWindow.length - 1].epoch} (${firstTs.toISOString()} → ${lastTs.toISOString()})`
      );
      lines.push(`# Days observed: ${daysObserved.toFixed(2)}`);
      lines.push(`# FX: ${fx}`);
      lines.push(``);
      lines.push(
        [
          "epoch",
          "timestamp",
          "stake_mon",
          "commission_pct",
          "unclaimed_mon",
          "commission_mon",
          "claimed_mon",
          "priority_fees_mon",
          "priority_fee_blocks",
          "fx_price_usd",
          "commission_usd",
          "priority_fees_usd",
        ].join(",")
      );
      for (const e of epochs) {
        lines.push(
          [
            e.epoch,
            e.timestamp,
            e.stakeMon,
            e.commissionPct.toFixed(2),
            e.unclaimedMon,
            e.commissionMon,
            e.claimedMon,
            e.priorityFeesMon,
            e.priorityFeeBlocks,
            e.fxPriceUsd,
            e.commissionUsd,
            e.priorityFeesUsd,
          ].join(",")
        );
      }
      lines.push(``);
      lines.push(`# Summary`);
      lines.push(`# Commission MON: ${summary.commissionMon}`);
      lines.push(`# Commission USD: ${summary.commissionUsd}`);
      lines.push(`# Priority fees MON: ${summary.priorityFeesMon}`);
      lines.push(`# Priority fees USD: ${summary.priorityFeesUsd}`);
      lines.push(`# Claimed MON: ${summary.claimedMon}`);
      lines.push(`# Unclaimed MON: ${summary.unclaimedMon}`);
      lines.push(`# Server cost USD (prorated): ${summary.serverCostProRatedUsd}`);
      lines.push(`# Net USD: ${summary.netUsd}`);

      return new NextResponse(lines.join("\n"), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="validator-${validatorId}-realized-report.csv"`,
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
        },
      });
    }

    const response = NextResponse.json({
      validatorId,
      validator: meta
        ? {
            validatorId: meta.validatorId,
            name: meta.name,
            authAddress: meta.authAddress,
            commissionPct: meta.commissionPct ? Number(meta.commissionPct) : 0,
            stakeMon: meta.stakeMon ? Number(meta.stakeMon) : 0,
          }
        : null,
      window: {
        fromEpoch: inWindow[0].epoch,
        toEpoch: inWindow[inWindow.length - 1].epoch,
        epochSpan,
        daysObserved,
        firstTimestamp: firstTs.toISOString(),
        lastTimestamp: lastTs.toISOString(),
      },
      summary,
      epochs,
      claimEvents,
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=120, stale-while-revalidate=300"
    );
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
