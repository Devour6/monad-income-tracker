import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epochSnapshots, networkEpochs } from "@/lib/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { calculateEpochReward } from "@/lib/monad-rpc";

/**
 * GET /api/validators/[id]/income?epochs=30
 *
 * Returns per-epoch REALIZED income history for a validator.
 *
 * Semantic model (SVT.one style):
 *  - `poolRewardsMon`      — total rewards earned by the stake pool (validator + all delegators)
 *  - `commissionMon`       — validator company's commission take (pool × commission_rate)
 *  - `delegatorRewardsMon` — what delegators collectively received (pool × (1 - commission_rate))
 *
 * The headline "income" for the validator company is `commissionMon` (plus whatever they earn
 * on their own self-stake, which we cannot distinguish from total stake on-chain).
 *
 * Summary returns TIME-BOUNDED realized stats, plus clearly-labeled RATES (per day/month/year)
 * derived from observed per-epoch averages. We do NOT extrapolate annual totals as a headline
 * number — that's the projection-vs-realized mistake SVT.one avoids.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const validatorId = parseInt(id, 10);
  if (isNaN(validatorId)) {
    return NextResponse.json(
      { error: "Invalid validator ID" },
      { status: 400 }
    );
  }

  const url = new URL(request.url);
  const epochCount = Math.min(
    parseInt(url.searchParams.get("epochs") || "30", 10),
    365
  );

  try {
    const snapshots = await db
      .select()
      .from(epochSnapshots)
      .where(eq(epochSnapshots.validatorId, validatorId))
      .orderBy(desc(epochSnapshots.epoch))
      .limit(epochCount + 1);

    if (snapshots.length === 0) {
      return NextResponse.json({
        validatorId,
        epochs: [],
        summary: null,
      });
    }

    const epochIds = snapshots.map((s) => s.epoch);
    const networkData = await db
      .select()
      .from(networkEpochs)
      .where(inArray(networkEpochs.epoch, epochIds));

    const priceMap = new Map<number, number>();
    for (const n of networkData) {
      priceMap.set(n.epoch, Number(n.monPriceUsd) || 0);
    }

    const chronological = [...snapshots].reverse();

    const incomeHistory: Array<{
      epoch: number;
      epochSpan: number;
      poolRewardsMon: number;
      commissionMon: number;
      delegatorRewardsMon: number;
      poolRewardsUsd: number;
      commissionUsd: number;
      stakeMon: number;
      commissionPct: number;
      monPriceUsd: number;
      timestamp: string;
    }> = [];

    let totalPoolRewards = 0;
    let totalCommission = 0;
    let totalEpochSpan = 0;

    for (let i = 1; i < chronological.length; i++) {
      const prev = chronological[i - 1];
      const curr = chronological[i];

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

      const stakeWei = BigInt(curr.stakeWei);
      const WEI = BigInt(10) ** BigInt(18);
      const stakeMon =
        Number(stakeWei / WEI) + Number(stakeWei % WEI) / Number(WEI);
      const monPrice = priceMap.get(curr.epoch) || 0;
      const epochSpan = curr.epoch - prev.epoch;

      totalPoolRewards += poolRewardsMon;
      totalCommission += commissionMon;
      totalEpochSpan += epochSpan;

      incomeHistory.push({
        epoch: curr.epoch,
        epochSpan,
        poolRewardsMon,
        commissionMon,
        delegatorRewardsMon,
        poolRewardsUsd: poolRewardsMon * monPrice,
        commissionUsd: commissionMon * monPrice,
        stakeMon,
        commissionPct: commissionRate * 100,
        monPriceUsd: monPrice,
        timestamp: curr.createdAt.toISOString(),
      });
    }

    const EPOCHS_PER_DAY = 4.36;
    const EPOCHS_PER_YEAR = EPOCHS_PER_DAY * 365;

    const observedDays = totalEpochSpan / EPOCHS_PER_DAY;
    const avgPoolPerEpoch =
      totalEpochSpan > 0 ? totalPoolRewards / totalEpochSpan : 0;
    const avgCommissionPerEpoch =
      totalEpochSpan > 0 ? totalCommission / totalEpochSpan : 0;

    const latestPrice = incomeHistory.length > 0
      ? incomeHistory[incomeHistory.length - 1].monPriceUsd
      : 0;

    const totalPoolUsd = incomeHistory.reduce((s, e) => s + e.poolRewardsUsd, 0);
    const totalCommissionUsd = incomeHistory.reduce((s, e) => s + e.commissionUsd, 0);

    const response = NextResponse.json({
      validatorId,
      epochs: [...incomeHistory].reverse(), // newest first for UI
      summary: {
        observed: {
          epochCount: totalEpochSpan,
          snapshotCount: incomeHistory.length,
          daysObserved: observedDays,
          poolRewardsMon: totalPoolRewards,
          poolRewardsUsd: totalPoolUsd,
          commissionMon: totalCommission,
          commissionUsd: totalCommissionUsd,
          delegatorRewardsMon: totalPoolRewards - totalCommission,
          firstEpoch: incomeHistory[0]?.epoch ?? null,
          lastEpoch: incomeHistory[incomeHistory.length - 1]?.epoch ?? null,
        },
        rates: {
          commissionPerEpochMon: avgCommissionPerEpoch,
          commissionPerDayMon: avgCommissionPerEpoch * EPOCHS_PER_DAY,
          commissionPerMonthMon: avgCommissionPerEpoch * EPOCHS_PER_DAY * 30,
          commissionPerYearMon: avgCommissionPerEpoch * EPOCHS_PER_YEAR,
          poolPerEpochMon: avgPoolPerEpoch,
          poolPerDayMon: avgPoolPerEpoch * EPOCHS_PER_DAY,
          poolPerMonthMon: avgPoolPerEpoch * EPOCHS_PER_DAY * 30,
          poolPerYearMon: avgPoolPerEpoch * EPOCHS_PER_YEAR,
          commissionPerDayUsd: avgCommissionPerEpoch * EPOCHS_PER_DAY * latestPrice,
          commissionPerMonthUsd: avgCommissionPerEpoch * EPOCHS_PER_DAY * 30 * latestPrice,
          commissionPerYearUsd: avgCommissionPerEpoch * EPOCHS_PER_YEAR * latestPrice,
          poolPerDayUsd: avgPoolPerEpoch * EPOCHS_PER_DAY * latestPrice,
          poolPerMonthUsd: avgPoolPerEpoch * EPOCHS_PER_DAY * 30 * latestPrice,
          poolPerYearUsd: avgPoolPerEpoch * EPOCHS_PER_YEAR * latestPrice,
        },
        latestMonPriceUsd: latestPrice,
      },
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=600"
    );
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
