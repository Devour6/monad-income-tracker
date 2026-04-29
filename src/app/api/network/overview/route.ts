import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  validators,
  epochSnapshots,
  networkEpochs,
  epochPriorityFees,
} from "@/lib/db/schema";
import { desc, sql, eq } from "drizzle-orm";
import { EPOCHS_PER_YEAR } from "@/lib/apy";
import { calculateEpochReward } from "@/lib/monad-rpc";

/**
 * GET /api/network/overview
 *
 * Returns aggregate network statistics:
 * - Total stake across all validators
 * - Active validator count
 * - Average commission rate
 * - Network APY (from latest 2 epoch snapshots)
 * - MON price (from latest networkEpochs row)
 * - Latest epoch number
 */
export async function GET() {
  try {
    // 1. Get latest 2 distinct epoch numbers from epochSnapshots
    const distinctEpochs = await db
      .selectDistinct({ epoch: epochSnapshots.epoch })
      .from(epochSnapshots)
      .orderBy(desc(epochSnapshots.epoch))
      .limit(2);

    if (distinctEpochs.length < 2) {
      return NextResponse.json(
        { error: "Insufficient epoch data — need at least 2 snapshots" },
        { status: 503 }
      );
    }

    const latestEpoch = distinctEpochs[0].epoch;
    const prevEpoch = distinctEpochs[1].epoch;
    const epochSpan = latestEpoch - prevEpoch;

    // 2. Fetch all snapshots for the two most recent epochs
    const [latestSnapshots, prevSnapshots] = await Promise.all([
      db
        .select()
        .from(epochSnapshots)
        .where(eq(epochSnapshots.epoch, latestEpoch)),
      db
        .select()
        .from(epochSnapshots)
        .where(eq(epochSnapshots.epoch, prevEpoch)),
    ]);

    // Build a map of validatorId -> snapshot for the previous epoch
    const prevMap = new Map(
      prevSnapshots.map((s) => [s.validatorId, s])
    );

    // 3. Compute network-wide APY from per-validator reward sums
    let totalRewardMon = 0;
    let totalStakeWei = BigInt(0);

    for (const curr of latestSnapshots) {
      const prev = prevMap.get(curr.validatorId);
      if (!prev) continue;

      const accOld = BigInt(prev.accRewardPerToken);
      const accNew = BigInt(curr.accRewardPerToken);
      const stakeWei = BigInt(prev.stakeWei);

      const { totalRewardMon: rewardMon } = calculateEpochReward(
        accOld,
        accNew,
        stakeWei
      );

      totalRewardMon += rewardMon;
      totalStakeWei += stakeWei;
    }

    // Compute network APY directly from aggregate reward and stake
    // Network return per epoch = totalRewardMon / totalStakeMon
    // Then annualize: APY = perEpochReturn * EPOCHS_PER_YEAR * 100
    let networkApy = 0;
    if (totalStakeWei > BigInt(0) && totalRewardMon > 0) {
      const WEI_PER_MON = BigInt(10) ** BigInt(18);
      const totalStakeMonFromWei =
        Number(totalStakeWei / WEI_PER_MON) +
        Number(totalStakeWei % WEI_PER_MON) / Number(WEI_PER_MON);

      if (totalStakeMonFromWei > 0 && epochSpan > 0) {
        const perEpochReturn =
          totalRewardMon / totalStakeMonFromWei / epochSpan;
        networkApy = perEpochReturn * EPOCHS_PER_YEAR * 100;
      }
    }

    // 4. Get aggregate validator stats from the validators table
    const [aggStats] = await db
      .select({
        totalStakeMon:
          sql<string>`coalesce(sum(${validators.stakeMon}), '0')`,
        activeCount: sql<number>`count(*)`,
        avgCommission:
          sql<string>`coalesce(avg(${validators.commissionPct}), '0')`,
      })
      .from(validators);

    // 5. Get MON price from the latest networkEpochs row
    const [latestNetworkEpoch] = await db
      .select()
      .from(networkEpochs)
      .orderBy(desc(networkEpochs.epoch))
      .limit(1);

    const monPriceUsd = latestNetworkEpoch
      ? Number(latestNetworkEpoch.monPriceUsd) || 0
      : 0;

    const totalStakeMon = Number(aggStats.totalStakeMon) || 0;

    // 6. Network-wide priority fees from the block indexer for the current
    //    epoch span. Reported as an aggregate so callers can see network
    //    MEV throughput. Returns null if the indexer hasn't covered these
    //    epochs yet (still warming up / backfilling).
    const [feeAgg] = (await db
      .select({
        feesWei: sql<string>`COALESCE(SUM(CAST(${epochPriorityFees.priorityFeesWei} AS NUMERIC)), 0)::TEXT`,
        blocks: sql<number>`COALESCE(SUM(${epochPriorityFees.blocksProposed}), 0)::int`,
      })
      .from(epochPriorityFees)
      .where(eq(epochPriorityFees.epoch, latestEpoch))) as unknown as Array<{
      feesWei: string;
      blocks: number;
    }>;

    let networkPriorityFeesMon: number | null = null;
    let networkPriorityFeeBlocks = 0;
    if (feeAgg && Number(feeAgg.blocks) > 0) {
      const WEI = BigInt(10) ** BigInt(18);
      const wei = BigInt(feeAgg.feesWei || "0");
      networkPriorityFeesMon =
        Number(wei / WEI) + Number(wei % WEI) / Number(WEI);
      networkPriorityFeeBlocks = Number(feeAgg.blocks);
    }

    const response = NextResponse.json({
      totalStakeMon,
      totalStakeUsd: totalStakeMon * monPriceUsd,
      activeValidators: aggStats.activeCount ?? 0,
      avgCommissionPct: Number(Number(aggStats.avgCommission).toFixed(2)),
      networkApy: Number(networkApy.toFixed(4)),
      networkPriorityFeesMon,
      networkPriorityFeesUsd:
        networkPriorityFeesMon != null
          ? networkPriorityFeesMon * monPriceUsd
          : null,
      networkPriorityFeeBlocks,
      monPriceUsd,
      latestEpoch,
      epochSpan,
      updatedAt: latestNetworkEpoch?.createdAt?.toISOString() ?? null,
    });

    response.headers.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=600"
    );
    return response;
  } catch (error) {
    console.error(
      "[network/overview] Error:",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
