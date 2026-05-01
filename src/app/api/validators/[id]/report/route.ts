import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  epochSnapshots,
  networkEpochs,
  epochPriorityFees,
  minerAliases,
  validators,
} from "@/lib/db/schema";
import { eq, desc, asc, inArray, sql, and, gte, lte } from "drizzle-orm";
import { calculateEpochReward } from "@/lib/monad-rpc";

/**
 * GET /api/validators/[id]/report
 *
 * Tax/accounting-grade income report for a validator over an arbitrary
 * window. The headline differentiator vs svt.one for Solana:
 *
 *   • Real per-block priority-fee data (not estimated)
 *   • FX methodology toggle:
 *       - `per-epoch`     → each epoch's MON valued at that epoch's price
 *       - `end-of-period` → all MON valued at the last epoch's price
 *   • Server cost subtraction (operator inputs USD/month, we prorate per
 *     epoch and net against gross USD income)
 *   • Date range OR epoch range — accepts whichever the caller has
 *   • CSV or JSON output
 *
 * Query params:
 *   from, to             — epoch numbers (inclusive)
 *   fromDate, toDate     — ISO date strings (snapshot.created_at filter)
 *   fx                   — "per-epoch" (default) | "end-of-period"
 *   serverCostUsd        — monthly server cost in USD (default 0)
 *   format               — "json" (default) | "csv"
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const validatorId = parseInt(id, 10);
  if (!Number.isFinite(validatorId)) {
    return NextResponse.json(
      { error: "Invalid validator ID" },
      { status: 400 }
    );
  }

  const url = new URL(request.url);
  const fx = (url.searchParams.get("fx") || "per-epoch") as
    | "per-epoch"
    | "end-of-period";
  const format = (url.searchParams.get("format") || "json") as "json" | "csv";
  const serverCostUsd = Math.max(
    0,
    Number(url.searchParams.get("serverCostUsd") || "0") || 0
  );

  const fromEpochParam = url.searchParams.get("from");
  const toEpochParam = url.searchParams.get("to");
  const fromDateParam = url.searchParams.get("fromDate");
  const toDateParam = url.searchParams.get("toDate");

  const fromEpoch = fromEpochParam != null ? parseInt(fromEpochParam, 10) : null;
  const toEpoch = toEpochParam != null ? parseInt(toEpochParam, 10) : null;
  const fromDate = fromDateParam ? new Date(fromDateParam) : null;
  const toDate = toDateParam ? new Date(toDateParam) : null;

  try {
    const validatorRow = (
      await db
        .select()
        .from(validators)
        .where(eq(validators.validatorId, validatorId))
        .limit(1)
    )[0];

    // Fetch snapshots filtered by either epoch range or date range.
    const conds = [eq(epochSnapshots.validatorId, validatorId)];
    if (fromEpoch != null && Number.isFinite(fromEpoch)) {
      conds.push(gte(epochSnapshots.epoch, fromEpoch));
    }
    if (toEpoch != null && Number.isFinite(toEpoch)) {
      conds.push(lte(epochSnapshots.epoch, toEpoch));
    }
    if (fromDate && !isNaN(fromDate.getTime())) {
      conds.push(gte(epochSnapshots.createdAt, fromDate));
    }
    if (toDate && !isNaN(toDate.getTime())) {
      conds.push(lte(epochSnapshots.createdAt, toDate));
    }

    // We need one extra snapshot BEFORE the window so we can compute the
    // first in-window epoch's reward delta. Fetch in chronological order.
    const inWindow = await db
      .select()
      .from(epochSnapshots)
      .where(and(...conds))
      .orderBy(asc(epochSnapshots.epoch));

    if (inWindow.length === 0) {
      return jsonOrCsv(
        {
          validatorId,
          validatorName: validatorRow?.name ?? null,
          window: { from: fromEpoch, to: toEpoch, fromDate, toDate, fx, serverCostUsd },
          rows: [],
          summary: emptySummary(),
        },
        format
      );
    }

    const firstEpoch = inWindow[0].epoch;
    const priorRow = (
      await db
        .select()
        .from(epochSnapshots)
        .where(
          and(
            eq(epochSnapshots.validatorId, validatorId),
            sql`${epochSnapshots.epoch} < ${firstEpoch}`
          )
        )
        .orderBy(desc(epochSnapshots.epoch))
        .limit(1)
    )[0];

    const chronological = priorRow ? [priorRow, ...inWindow] : inWindow;

    const epochIds = chronological.map((s) => s.epoch);

    const networkData = await db
      .select()
      .from(networkEpochs)
      .where(inArray(networkEpochs.epoch, epochIds));
    const priceMap = new Map<number, number>();
    for (const n of networkData) {
      priceMap.set(n.epoch, Number(n.monPriceUsd) || 0);
    }

    const priorityFeeRows = (await db
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
        sql`${minerAliases.validatorId} = ${validatorId} AND ${epochPriorityFees.epoch} IN ${epochIds}`
      )
      .groupBy(epochPriorityFees.epoch)) as unknown as {
      epoch: number;
      feesWei: string;
      blocks: number;
    }[];

    const pfMap = new Map<number, { feesWei: bigint; blocks: number }>();
    for (const r of priorityFeeRows) {
      pfMap.set(r.epoch, {
        feesWei: BigInt(r.feesWei || "0"),
        blocks: Number(r.blocks || 0),
      });
    }

    const WEI = BigInt(10) ** BigInt(18);
    const EPOCHS_PER_DAY = 4.36;

    // End-of-period FX = price at the last in-window epoch (or latest
    // available if missing).
    let endOfPeriodPrice = 0;
    for (let i = chronological.length - 1; i >= 0; i--) {
      const p = priceMap.get(chronological[i].epoch);
      if (p && p > 0) {
        endOfPeriodPrice = p;
        break;
      }
    }

    const rows: ReportRow[] = [];
    let totalPool = 0;
    let totalCommission = 0;
    let totalSelfStakeRewards = 0;
    let totalPriorityFees = 0;
    let totalValidatorMon = 0;
    let totalPoolUsd = 0;
    let totalCommissionUsd = 0;
    let totalPriorityFeesUsd = 0;
    let totalValidatorUsd = 0;
    let totalEpochSpan = 0;
    let hasSelfStakeData = false;
    let hasPriorityFeeData = false;

    for (let i = 1; i < chronological.length; i++) {
      const prev = chronological[i - 1];
      const curr = chronological[i];

      // Skip the synthetic prior row pair if we're past it but the curr
      // happens to be outside the window (shouldn't, but defensive).
      const prevAcc = BigInt(prev.accRewardPerToken);
      const currAcc = BigInt(curr.accRewardPerToken);
      const prevStakeWei = BigInt(prev.stakeWei);

      const { totalRewardMon: poolRewardsMon } = calculateEpochReward(
        prevAcc,
        currAcc,
        prevStakeWei
      );

      const commissionRate = Number(BigInt(curr.commission)) / 1e18;
      const commissionMon = poolRewardsMon * commissionRate;
      const delegatorRewardsMon = poolRewardsMon - commissionMon;

      let selfStakeRewardsMon = 0;
      let selfStakeMon: number | null = null;
      if (prev.selfStakeWei != null) {
        hasSelfStakeData = true;
        const prevSelfStakeWei = BigInt(prev.selfStakeWei);
        selfStakeMon = weiToMon(prevSelfStakeWei, WEI);
        if (prevStakeWei > BigInt(0) && delegatorRewardsMon > 0) {
          const RATIO_SCALE = BigInt(10) ** BigInt(18);
          const shareScaled =
            (prevSelfStakeWei * RATIO_SCALE) / prevStakeWei;
          const share = Number(shareScaled) / Number(RATIO_SCALE);
          selfStakeRewardsMon = delegatorRewardsMon * share;
        }
      }

      let priorityFeesMon = 0;
      let priorityFeeBlocks = 0;
      const pf = pfMap.get(curr.epoch);
      if (pf && pf.blocks > 0) {
        hasPriorityFeeData = true;
        priorityFeesMon = weiToMon(pf.feesWei, WEI);
        priorityFeeBlocks = pf.blocks;
      }

      const validatorTotalMon =
        commissionMon + selfStakeRewardsMon + priorityFeesMon;

      const epochPrice = priceMap.get(curr.epoch) ?? 0;
      const fxPrice = fx === "end-of-period" ? endOfPeriodPrice : epochPrice;

      const stakeMon = weiToMon(BigInt(curr.stakeWei), WEI);
      const epochSpan = curr.epoch - prev.epoch;

      const row: ReportRow = {
        epoch: curr.epoch,
        epochSpan,
        timestamp: curr.createdAt.toISOString(),
        stakeMon,
        selfStakeMon,
        commissionPct: commissionRate * 100,
        poolRewardsMon,
        commissionMon,
        delegatorRewardsMon,
        selfStakeRewardsMon,
        priorityFeesMon,
        priorityFeeBlocks,
        validatorTotalMon,
        fxPriceUsd: fxPrice,
        poolRewardsUsd: poolRewardsMon * fxPrice,
        commissionUsd: commissionMon * fxPrice,
        priorityFeesUsd: priorityFeesMon * fxPrice,
        validatorTotalUsd: validatorTotalMon * fxPrice,
      };

      // Only count rows whose `curr.epoch` is actually in-window.
      const inWindowRow =
        (fromEpoch == null || curr.epoch >= fromEpoch) &&
        (toEpoch == null || curr.epoch <= toEpoch);
      if (!inWindowRow) continue;

      rows.push(row);
      totalPool += poolRewardsMon;
      totalCommission += commissionMon;
      totalSelfStakeRewards += selfStakeRewardsMon;
      totalPriorityFees += priorityFeesMon;
      totalValidatorMon += validatorTotalMon;
      totalPoolUsd += row.poolRewardsUsd;
      totalCommissionUsd += row.commissionUsd;
      totalPriorityFeesUsd += row.priorityFeesUsd;
      totalValidatorUsd += row.validatorTotalUsd;
      totalEpochSpan += epochSpan;
    }

    const observedDays = totalEpochSpan / EPOCHS_PER_DAY;
    const serverCostTotalUsd = (serverCostUsd / 30) * observedDays;
    const netValidatorUsd = totalValidatorUsd - serverCostTotalUsd;

    const summary: ReportSummary = {
      epochCount: rows.length,
      epochSpan: totalEpochSpan,
      observedDays,
      firstEpoch: rows[0]?.epoch ?? null,
      lastEpoch: rows[rows.length - 1]?.epoch ?? null,
      firstTimestamp: rows[0]?.timestamp ?? null,
      lastTimestamp: rows[rows.length - 1]?.timestamp ?? null,
      poolRewardsMon: totalPool,
      commissionMon: totalCommission,
      delegatorRewardsMon: totalPool - totalCommission,
      selfStakeRewardsMon: hasSelfStakeData ? totalSelfStakeRewards : null,
      priorityFeesMon: hasPriorityFeeData ? totalPriorityFees : null,
      validatorTotalMon: hasSelfStakeData ? totalValidatorMon : null,
      poolRewardsUsd: totalPoolUsd,
      commissionUsd: totalCommissionUsd,
      priorityFeesUsd: hasPriorityFeeData ? totalPriorityFeesUsd : null,
      validatorTotalUsd: hasSelfStakeData ? totalValidatorUsd : null,
      serverCostMonthlyUsd: serverCostUsd,
      serverCostProRatedUsd: serverCostTotalUsd,
      netValidatorUsd: hasSelfStakeData ? netValidatorUsd : null,
      fxMethodology: fx,
      endOfPeriodPriceUsd: endOfPeriodPrice,
      hasSelfStakeData,
      hasPriorityFeeData,
    };

    return jsonOrCsv(
      {
        validatorId,
        validatorName: validatorRow?.name ?? null,
        window: { from: fromEpoch, to: toEpoch, fromDate, toDate, fx, serverCostUsd },
        rows,
        summary,
      },
      format
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

function weiToMon(wei: bigint, WEI: bigint): number {
  return Number(wei / WEI) + Number(wei % WEI) / Number(WEI);
}

interface ReportRow {
  epoch: number;
  epochSpan: number;
  timestamp: string;
  stakeMon: number;
  selfStakeMon: number | null;
  commissionPct: number;
  poolRewardsMon: number;
  commissionMon: number;
  delegatorRewardsMon: number;
  selfStakeRewardsMon: number;
  priorityFeesMon: number;
  priorityFeeBlocks: number;
  validatorTotalMon: number;
  fxPriceUsd: number;
  poolRewardsUsd: number;
  commissionUsd: number;
  priorityFeesUsd: number;
  validatorTotalUsd: number;
}

interface ReportSummary {
  epochCount: number;
  epochSpan: number;
  observedDays: number;
  firstEpoch: number | null;
  lastEpoch: number | null;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  poolRewardsMon: number;
  commissionMon: number;
  delegatorRewardsMon: number;
  selfStakeRewardsMon: number | null;
  priorityFeesMon: number | null;
  validatorTotalMon: number | null;
  poolRewardsUsd: number;
  commissionUsd: number;
  priorityFeesUsd: number | null;
  validatorTotalUsd: number | null;
  serverCostMonthlyUsd: number;
  serverCostProRatedUsd: number;
  netValidatorUsd: number | null;
  fxMethodology: "per-epoch" | "end-of-period";
  endOfPeriodPriceUsd: number;
  hasSelfStakeData: boolean;
  hasPriorityFeeData: boolean;
}

function emptySummary(): ReportSummary {
  return {
    epochCount: 0,
    epochSpan: 0,
    observedDays: 0,
    firstEpoch: null,
    lastEpoch: null,
    firstTimestamp: null,
    lastTimestamp: null,
    poolRewardsMon: 0,
    commissionMon: 0,
    delegatorRewardsMon: 0,
    selfStakeRewardsMon: null,
    priorityFeesMon: null,
    validatorTotalMon: null,
    poolRewardsUsd: 0,
    commissionUsd: 0,
    priorityFeesUsd: null,
    validatorTotalUsd: null,
    serverCostMonthlyUsd: 0,
    serverCostProRatedUsd: 0,
    netValidatorUsd: null,
    fxMethodology: "per-epoch",
    endOfPeriodPriceUsd: 0,
    hasSelfStakeData: false,
    hasPriorityFeeData: false,
  };
}

function jsonOrCsv(
  payload: {
    validatorId: number;
    validatorName: string | null;
    window: unknown;
    rows: ReportRow[];
    summary: ReportSummary;
  },
  format: "json" | "csv"
) {
  if (format !== "csv") {
    const r = NextResponse.json(payload);
    r.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return r;
  }

  const header = [
    "epoch",
    "epoch_span",
    "timestamp",
    "stake_mon",
    "self_stake_mon",
    "commission_pct",
    "pool_rewards_mon",
    "commission_mon",
    "delegator_rewards_mon",
    "self_stake_rewards_mon",
    "priority_fees_mon",
    "priority_fee_blocks",
    "validator_total_mon",
    "fx_price_usd",
    "pool_rewards_usd",
    "commission_usd",
    "priority_fees_usd",
    "validator_total_usd",
  ].join(",");

  const lines = payload.rows.map((r) =>
    [
      r.epoch,
      r.epochSpan,
      r.timestamp,
      r.stakeMon,
      r.selfStakeMon ?? "",
      r.commissionPct,
      r.poolRewardsMon,
      r.commissionMon,
      r.delegatorRewardsMon,
      r.selfStakeRewardsMon,
      r.priorityFeesMon,
      r.priorityFeeBlocks,
      r.validatorTotalMon,
      r.fxPriceUsd,
      r.poolRewardsUsd,
      r.commissionUsd,
      r.priorityFeesUsd,
      r.validatorTotalUsd,
    ].join(",")
  );

  // Footer with summary totals
  const s = payload.summary;
  const summaryBlock = [
    "",
    `# validator_id,${payload.validatorId}`,
    `# validator_name,${payload.validatorName ?? ""}`,
    `# fx_methodology,${s.fxMethodology}`,
    `# end_of_period_price_usd,${s.endOfPeriodPriceUsd}`,
    `# epoch_count,${s.epochCount}`,
    `# epoch_span,${s.epochSpan}`,
    `# observed_days,${s.observedDays}`,
    `# total_pool_rewards_mon,${s.poolRewardsMon}`,
    `# total_commission_mon,${s.commissionMon}`,
    `# total_priority_fees_mon,${s.priorityFeesMon ?? ""}`,
    `# total_validator_mon,${s.validatorTotalMon ?? ""}`,
    `# total_pool_rewards_usd,${s.poolRewardsUsd}`,
    `# total_commission_usd,${s.commissionUsd}`,
    `# total_priority_fees_usd,${s.priorityFeesUsd ?? ""}`,
    `# total_validator_usd,${s.validatorTotalUsd ?? ""}`,
    `# server_cost_monthly_usd,${s.serverCostMonthlyUsd}`,
    `# server_cost_pro_rated_usd,${s.serverCostProRatedUsd}`,
    `# net_validator_usd,${s.netValidatorUsd ?? ""}`,
  ].join("\n");

  const csv = [header, ...lines, summaryBlock].join("\n");
  const filename = `validator-${payload.validatorId}-report-${s.firstEpoch ?? "x"}-to-${s.lastEpoch ?? "x"}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
