import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epochSnapshots, networkEpochs } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";

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
      .where(
        // Get all network epochs for our range
        eq(networkEpochs.epoch, epochIds[0]) // simplified — will improve
      );

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
      const stakeMon =
        Number(BigInt(curr.stakeWei) / BigInt(10) ** BigInt(18));
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

    return NextResponse.json({
      validatorId,
      epochs: incomeHistory.reverse(), // Return newest first
      summary: {
        totalEpochs: incomeHistory.length,
        epochsWithIncome: epochsWithData.length,
        totalBlockRewardsMon: totalBlockRewards,
        totalCommissionMon: totalCommission,
        avgBlockRewardsPerEpoch: avgPerEpoch,
        estimatedDailyMon: avgPerEpoch * epochsPerDay,
        estimatedMonthlyMon: avgPerEpoch * epochsPerDay * 30,
        estimatedAnnualMon: avgPerEpoch * epochsPerDay * 365,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
