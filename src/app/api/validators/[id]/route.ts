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
 * - APY computed from the latest 2 epoch snapshots (pool-level, gross of commission)
 * - Realized income: commission, pool, delegator earnings over observed window
 * - Stake history (last N snapshots)
 * - Commission history (last N snapshots)
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

    const snapshots = await db
      .select()
      .from(epochSnapshots)
      .where(eq(epochSnapshots.validatorId, validatorId))
      .orderBy(desc(epochSnapshots.epoch))
      .limit(epochCount + 1);

    // APY from the latest 2 snapshots (pool-level)
    let apy = 0;
    if (snapshots.length >= 2) {
      const latest = snapshots[0];
      const prev = snapshots[1];
      const epochSpan = latest.epoch - prev.epoch;
      if (epochSpan > 0) {
        apy = computeApy(
          BigInt(prev.accRewardPerToken),
          BigInt(latest.accRewardPerToken),
          BigInt(prev.stakeWei),
          epochSpan
        );
      }
    }

    // Stake history
    const stakeHistory = snapshots.map((s) => {
      const sw = BigInt(s.stakeWei);
      const stakeMon =
        Number(sw / WEI_PER_MON) +
        Number(sw % WEI_PER_MON) / Number(WEI_PER_MON);
      return { epoch: s.epoch, stakeMon, stakeWei: s.stakeWei };
    });

    // Commission history (raw is 18-decimal fixed-point; /1e16 → percentage 0-100)
    const commissionHistory = snapshots.map((s) => ({
      epoch: s.epoch,
      commissionPct: Number(BigInt(s.commission)) / 1e16,
      commissionRaw: s.commission,
    }));

    // Realized income across consecutive snapshot pairs
    const chronological = [...snapshots].reverse();
    let totalPool = 0;
    let totalCommission = 0;
    let totalEpochSpan = 0;

    for (let i = 1; i < chronological.length; i++) {
      const prev = chronological[i - 1];
      const curr = chronological[i];
      const { totalRewardMon: poolMon } = calculateEpochReward(
        BigInt(prev.accRewardPerToken),
        BigInt(curr.accRewardPerToken),
        BigInt(prev.stakeWei)
      );
      const commissionRate = Number(BigInt(curr.commission)) / 1e18;
      totalPool += poolMon;
      totalCommission += poolMon * commissionRate;
      totalEpochSpan += curr.epoch - prev.epoch;
    }

    const avgPoolPerEpoch =
      totalEpochSpan > 0 ? totalPool / totalEpochSpan : 0;
    const avgCommissionPerEpoch =
      totalEpochSpan > 0 ? totalCommission / totalEpochSpan : 0;

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
        observed: {
          epochCount: totalEpochSpan,
          snapshotCount: chronological.length > 1 ? chronological.length - 1 : 0,
          daysObserved: totalEpochSpan / EPOCHS_PER_DAY,
          poolRewardsMon: totalPool,
          commissionMon: totalCommission,
          delegatorRewardsMon: totalPool - totalCommission,
        },
        rates: {
          commissionPerEpochMon: avgCommissionPerEpoch,
          commissionPerDayMon: avgCommissionPerEpoch * EPOCHS_PER_DAY,
          commissionPerMonthMon: avgCommissionPerEpoch * EPOCHS_PER_DAY * 30,
          commissionPerYearMon: avgCommissionPerEpoch * EPOCHS_PER_DAY * 365,
          poolPerEpochMon: avgPoolPerEpoch,
          poolPerDayMon: avgPoolPerEpoch * EPOCHS_PER_DAY,
          poolPerMonthMon: avgPoolPerEpoch * EPOCHS_PER_DAY * 30,
          poolPerYearMon: avgPoolPerEpoch * EPOCHS_PER_DAY * 365,
        },
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
