import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epochSnapshots, networkEpochs } from "@/lib/db/schema";
import { eq, desc, inArray } from "drizzle-orm";

/**
 * GET /api/validators/[id]/income?epochs=30
 *
 * Returns per-epoch income history for a validator.
 * Each entry includes block rewards, commission income, and MON price.
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
    // Fetch epoch snapshots for this validator
    const snapshots = await db
      .select()
      .from(epochSnapshots)
      .where(eq(epochSnapshots.validatorId, validatorId))
      .orderBy(desc(epochSnapshots.epoch))
      .limit(epochCount + 1); // +1 to compute delta for the oldest

    if (snapshots.length === 0) {
      return NextResponse.json({
        validatorId,
        epochs: [],
        summary: null,
      });
    }

    // Fetch network epoch data for MON prices
    const epochIds = snapshots.map((s) => s.epoch);
    const networkData = await db
      .select()
      .from(networkEpochs)
      .where(inArray(networkEpochs.epoch, epochIds));

    // Build a map of epoch → MON price
    const priceMap = new Map<number, number>();
    for (const n of networkData) {
      priceMap.set(n.epoch, Number(n.monPriceUsd) || 0);
    }

    // Compute income for each epoch (need delta from previous)
    const incomeHistory = [];
    let totalBlockRewards = 0;
    let totalCommission = 0;

    // Snapshots are in desc order, reverse for chronological processing
    const chronological = [...snapshots].reverse();

    for (let i = 1; i < chronological.length; i++) {
      const prev = chronological[i - 1];
      const curr = chronological[i];

      const blockRewards = Number(curr.blockRewardsMon) || 0;
      const commissionIncome = Number(curr.commissionMon) || 0;
      const stakeWei = BigInt(curr.stakeWei);
      const WEI = BigInt(10) ** BigInt(18);
      const stakeMon = Number(stakeWei / WEI) + Number(stakeWei % WEI) / Number(WEI);
      const monPrice = priceMap.get(curr.epoch) || 0;

      totalBlockRewards += blockRewards;
      totalCommission += commissionIncome;

      incomeHistory.push({
        epoch: curr.epoch,
        blockRewardsMon: blockRewards,
        commissionMon: commissionIncome,
        totalMon: blockRewards, // block rewards ARE the total (commission is a subset)
        totalUsd: blockRewards * monPrice,
        stakeMon,
        monPriceUsd: monPrice,
        timestamp: curr.createdAt.toISOString(),
      });
    }

    // Summary stats
    const epochsWithData = incomeHistory.filter((e) => e.totalMon > 0);
    const avgPerEpoch =
      epochsWithData.length > 0
        ? totalBlockRewards / epochsWithData.length
        : 0;

    // ~4.36 epochs per day (50,000 blocks/epoch, ~216,000 blocks/day)
    const epochsPerDay = 4.36;

    // Get latest MON price for USD estimates
    const latestPrice = incomeHistory.length > 0
      ? incomeHistory[incomeHistory.length - 1].monPriceUsd
      : 0;
    const totalUsd = incomeHistory.reduce((sum, e) => sum + e.totalUsd, 0);

    const response = NextResponse.json({
      validatorId,
      epochs: incomeHistory.reverse(), // Return newest first
      summary: {
        totalEpochs: incomeHistory.length,
        epochsWithIncome: epochsWithData.length,
        totalBlockRewardsMon: totalBlockRewards,
        totalBlockRewardsUsd: totalUsd,
        totalCommissionMon: totalCommission,
        avgBlockRewardsPerEpoch: avgPerEpoch,
        estimatedDailyMon: avgPerEpoch * epochsPerDay,
        estimatedDailyUsd: avgPerEpoch * epochsPerDay * latestPrice,
        estimatedMonthlyMon: avgPerEpoch * epochsPerDay * 30,
        estimatedMonthlyUsd: avgPerEpoch * epochsPerDay * 30 * latestPrice,
        estimatedAnnualMon: avgPerEpoch * epochsPerDay * 365,
        estimatedAnnualUsd: avgPerEpoch * epochsPerDay * 365 * latestPrice,
        latestMonPriceUsd: latestPrice,
      },
    });
    response.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
