import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  epochSnapshots,
  networkEpochs,
  validators,
  epochPriorityFees,
  minerAliases,
} from "@/lib/db/schema";
import { eq, asc, inArray, sql, and } from "drizzle-orm";
import { getLiveMonPrice } from "@/lib/price";

/**
 * GET /api/v1/validators/[id]/realized-report
 *
 * Per-epoch income report using the correct accumulator-based commission math:
 *   pool_wei  = (accRewardPerToken_curr - accRewardPerToken_prev) * stake_prev / 1e36
 *   comm_wei  = pool_wei * commission_rate_curr / 1e18
 *
 * `unclaimed_rewards` field on the precompile actually tracks the FULL pool
 * (commission + delegator share), not commission alone — empirically verified.
 * Using its delta as commission overcounts by ~1/commission_rate.
 *
 * Query params:
 *   format=json|csv               — default json
 *   fromDate=ISO  toDate=ISO      — optional window restriction
 *   fromEpoch=N   toEpoch=N       — alternative window restriction
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

    // Pull every snapshot we have for this validator. Window filtering
    // happens after fetch so we can use the snapshot just BEFORE the window
    // as a baseline for the first delta.
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

    // Determine window. Date → epoch projection uses the LATEST snapshot
    // as anchor (its createdAt is real chain time; backfilled rows share
    // a backfill timestamp). At 4.36 epochs/day project backwards.
    let windowFromEpoch = fromEpochParam ? parseInt(fromEpochParam, 10) : null;
    let windowToEpoch = toEpochParam ? parseInt(toEpochParam, 10) : null;
    const EPOCHS_PER_DAY = 4.36;
    const MS_PER_DAY = 86_400_000;
    if (fromDate || toDate) {
      const anchor = allSnaps[allSnaps.length - 1];
      const anchorMs = anchor.createdAt.getTime();
      const dateToEpoch = (iso: string): number => {
        const t = new Date(iso).getTime();
        const daysAgo = (anchorMs - t) / MS_PER_DAY;
        return Math.round(anchor.epoch - daysAgo * EPOCHS_PER_DAY);
      };
      if (fromDate && windowFromEpoch == null) {
        windowFromEpoch = dateToEpoch(fromDate);
      }
      if (toDate && windowToEpoch == null) {
        windowToEpoch = dateToEpoch(toDate);
      }
    }
    if (windowFromEpoch == null) windowFromEpoch = allSnaps[0].epoch;
    if (windowToEpoch == null)
      windowToEpoch = allSnaps[allSnaps.length - 1].epoch;

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

    const live = await getLiveMonPrice().catch(() => ({ price: 0 }));
    const livePrice = (live as { price: number }).price || 0;
    const endOfPeriodPrice = priceMap.get(windowToEpoch!) || livePrice || 0;

    // Priority fees per epoch attributed to this validator.
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
    const ACCUMULATOR_DENOMINATOR = BigInt(10) ** BigInt(36);
    const toMon = (wei: bigint) =>
      Number(wei / WEI) + Number(wei % WEI) / Number(WEI);

    const pfMap = new Map<number, { feesMon: number; blocks: number }>();
    for (const r of pfRows) {
      pfMap.set(r.epoch, {
        feesMon: toMon(BigInt(r.feesWei || "0")),
        blocks: Number(r.blocks || 0),
      });
    }

    // Walk window snapshots, computing per-epoch commission via accumulator math.
    const epochs: Array<{
      epoch: number;
      timestamp: string;
      stakeMon: number;
      commissionPct: number;
      unclaimedMon: number;
      commissionMon: number;
      poolMon: number;
      claimedMon: number;
      priorityFeesMon: number;
      priorityFeeBlocks: number;
      fxPriceUsd: number;
      commissionUsd: number;
      priorityFeesUsd: number;
    }> = [];

    let summaryCommissionMon = 0;
    let summaryPoolMon = 0;
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

    // Baseline for accumulator/unclaimed deltas. Prefer the snapshot just
    // BEFORE the window. Otherwise use the first in-window snapshot itself
    // (yielding 0 accrual on that row).
    let prevAcc: bigint;
    let prevStake: bigint;
    let prevUnclaimed: bigint;
    let firstWindowEpoch: number | null = null;
    if (baseline) {
      prevAcc = BigInt(baseline.accRewardPerToken);
      prevStake = BigInt(baseline.stakeWei);
      prevUnclaimed = BigInt(baseline.unclaimedRewards);
    } else {
      prevAcc = BigInt(inWindow[0].accRewardPerToken);
      prevStake = BigInt(inWindow[0].stakeWei);
      prevUnclaimed = BigInt(inWindow[0].unclaimedRewards);
      firstWindowEpoch = inWindow[0].epoch;
    }

    for (const s of inWindow) {
      const accCurr = BigInt(s.accRewardPerToken);
      const stakeCurr = BigInt(s.stakeWei);
      const unclaimedCurr = BigInt(s.unclaimedRewards);
      const commission = BigInt(s.commission);

      // Pool reward this epoch via accumulator delta.
      let poolMon = 0;
      let commissionMon = 0;
      if (s.epoch !== firstWindowEpoch) {
        const accDelta = accCurr - prevAcc;
        if (accDelta > BigInt(0) && prevStake > BigInt(0)) {
          const poolWei = (accDelta * prevStake) / ACCUMULATOR_DENOMINATOR;
          poolMon = toMon(poolWei);
          // commission stored with 1e18 precision (e.g. 0.20e18 = 20%)
          const commWei = (poolWei * commission) / WEI;
          commissionMon = toMon(commWei);
        }
      }

      // Detect claim events (drop in unclaimed_rewards). Note: this drop
      // represents the full pool's distribution, not the validator's
      // commission take. Surfaced as a separate signal.
      let claimedMon = 0;
      if (unclaimedCurr < prevUnclaimed) {
        claimedMon = toMon(prevUnclaimed - unclaimedCurr);
      }

      const stakeMon = toMon(stakeCurr);
      const commissionPctRaw = Number(commission) / 1e18;

      const pf = pfMap.get(s.epoch);
      const priorityFeesMon = pf?.feesMon ?? 0;
      const priorityFeeBlocks = pf?.blocks ?? 0;

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
        unclaimedMon: toMon(unclaimedCurr),
        commissionMon,
        poolMon,
        claimedMon,
        priorityFeesMon,
        priorityFeeBlocks,
        fxPriceUsd: fxPrice,
        commissionUsd,
        priorityFeesUsd,
      });

      summaryCommissionMon += commissionMon;
      summaryPoolMon += poolMon;
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

      prevAcc = accCurr;
      prevStake = stakeCurr;
      prevUnclaimed = unclaimedCurr;
    }

    const firstTs = inWindow[0].createdAt;
    const lastTs = inWindow[inWindow.length - 1].createdAt;
    const epochSpan = inWindow[inWindow.length - 1].epoch - inWindow[0].epoch;
    const daysObserved = epochSpan / 4.36;

    const serverCostProRatedUsd =
      (serverCostMonthlyUsd / 30) * Math.max(0, daysObserved);

    const totalIncomeMon = summaryCommissionMon + summaryPriorityFeesMon;
    const totalIncomeUsd = summaryCommissionUsd + summaryPriorityFeesUsd;
    const netUsd = totalIncomeUsd - serverCostProRatedUsd;

    const summary = {
      commissionMon: summaryCommissionMon,
      commissionUsd: summaryCommissionUsd,
      poolMon: summaryPoolMon,
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
      const validatorName = meta?.name || `Validator #${validatorId}`;
      const lines: string[] = [];
      lines.push(`# Monad Validator Income Report`);
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
          "pool_mon",
          "commission_mon",
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
            e.poolMon,
            e.commissionMon,
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
      lines.push(`# Pool total MON: ${summary.poolMon}`);
      lines.push(`# Priority fees MON: ${summary.priorityFeesMon}`);
      lines.push(`# Priority fees USD: ${summary.priorityFeesUsd}`);
      lines.push(`# Server cost USD (prorated): ${summary.serverCostProRatedUsd}`);
      lines.push(`# Net USD: ${summary.netUsd}`);

      return new NextResponse(lines.join("\n"), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="validator-${validatorId}-report.csv"`,
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
