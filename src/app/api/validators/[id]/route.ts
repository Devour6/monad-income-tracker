import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validators, epochSnapshots } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { computeApy, EPOCHS_PER_DAY } from "@/lib/apy";
import { calculateEpochReward } from "@/lib/monad-rpc";

const WEI_PER_MON = BigInt(10) ** BigInt(18);

/**
 * GET /api/validators/[id]?epochs=30
 *
 * Returns detailed info for a single validator:
 * - Basic metadata from the validators table
 * - APY computed from the latest 2 epoch snapshots
 * - Stake history (last N epochs)
 * - Commission history (last N epochs)
 *
 * Query params:
 *   - epochs: Number of epochs of history to return (default 30, max 365)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const validatorId = parseInt(id, 10);

  if (isNaN(validatorId) || validatorId < 1) {
    return NextResponse.json(
      { error: "Invalid validator ID" },
      { status: 400 }
    );
  }

  const url = new URL(request.url);
  const rawEpochs = parseInt(url.searchParams.get("epochs") || "30", 10);
  const epochCount = Math.min(
    Math.max(isNaN(rawEpochs) ? 30 : rawEpochs, 1),
    365
  );

  try {
    // 1. Get validator metadata
    const [validator] = await db
      .select()
      .from(validators)
      .where(eq(validators.validatorId, validatorId))
      .limit(1);

    if (!validator) {
      return NextResponse.json(
        { error: `Validator ${validatorId} not found` },
        { status: 404 }
      );
    }

    // 2. Get epoch snapshots for this validator (epochCount + 1 for delta computation)
    const snapshots = await db
      .select()
      .from(epochSnapshots)
      .where(eq(epochSnapshots.validatorId, validatorId))
      .orderBy(desc(epochSnapshots.epoch))
      .limit(epochCount + 1);

    // 3. Compute APY from the latest 2 snapshots
    let apy = 0;
    if (snapshots.length >= 2) {
      const latest = snapshots[0];
      const prev = snapshots[1];
      const epochSpan = latest.epoch - prev.epoch;

      if (epochSpan > 0) {
        const accOld = BigInt(prev.accRewardPerToken);
        const accNew = BigInt(latest.accRewardPerToken);
        const stakeWei = BigInt(prev.stakeWei);

        apy = computeApy(accOld, accNew, stakeWei, epochSpan);
      }
    }

    // 4. Build stake history and commission history from snapshots
    //    Snapshots are already in desc order (newest first)
    const stakeHistory = snapshots.map((s) => {
      const sw = BigInt(s.stakeWei);
      const stakeMon =
        Number(sw / WEI_PER_MON) + Number(sw % WEI_PER_MON) / Number(WEI_PER_MON);
      return {
        epoch: s.epoch,
        stakeMon,
        stakeWei: s.stakeWei,
      };
    });

    const commissionHistory = snapshots.map((s) => {
      // Commission is an 18-decimal fixed-point value, e.g. 200000000000000000 = 20%
      const commissionRaw = BigInt(s.commission);
      const commissionPct = Number(commissionRaw) / 1e16; // Convert to percentage (0-100)
      return {
        epoch: s.epoch,
        commissionPct,
        commissionRaw: s.commission,
      };
    });

    // 5. Compute income summary from consecutive snapshot deltas
    const chronological = [...snapshots].reverse();
    let totalIncomeMon = 0;

    for (let i = 1; i < chronological.length; i++) {
      const prev = chronological[i - 1];
      const curr = chronological[i];

      const accOld = BigInt(prev.accRewardPerToken);
      const accNew = BigInt(curr.accRewardPerToken);
      const stakeWei = BigInt(prev.stakeWei);

      const { totalRewardMon } = calculateEpochReward(accOld, accNew, stakeWei);
      totalIncomeMon += totalRewardMon;
    }

    const epochsWithData = chronological.length > 1 ? chronological.length - 1 : 0;
    const avgPerEpoch = epochsWithData > 0 ? totalIncomeMon / epochsWithData : 0;

    const response = NextResponse.json({
      validator: {
        validatorId: validator.validatorId,
        name: validator.name || `Validator #${validator.validatorId}`,
        authAddress: validator.authAddress,
        stakeMon: Number(validator.stakeMon) || 0,
        commissionPct: Number(validator.commissionPct) || 0,
        lastEpoch: validator.lastEpoch,
        updatedAt: validator.updatedAt.toISOString(),
      },
      apy: Number(apy.toFixed(4)),
      income: {
        totalIncomeMon,
        epochsAnalyzed: epochsWithData,
        avgPerEpoch,
        estimatedDailyMon: avgPerEpoch * EPOCHS_PER_DAY,
        estimatedMonthlyMon: avgPerEpoch * EPOCHS_PER_DAY * 30,
        estimatedAnnualMon: avgPerEpoch * EPOCHS_PER_DAY * 365,
      },
      stakeHistory,
      commissionHistory,
      latestEpoch: snapshots.length > 0 ? snapshots[0].epoch : null,
    });

    response.headers.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=600"
    );
    return response;
  } catch (error) {
    console.error(
      `[validators/${validatorId}] Error:`,
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
