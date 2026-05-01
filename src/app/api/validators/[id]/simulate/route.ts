import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epochSnapshots, networkEpochs } from "@/lib/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { calculateEpochReward } from "@/lib/monad-rpc";

/**
 * GET /api/validators/[id]/simulate?stakeMon=1000&horizonDays=365&lookback=60
 *
 * Delegator income projection. Models what a delegator would have earned
 * historically with their stake added to this validator's pool, then
 * projects forward over `horizonDays` using the observed mean +/- 1 sigma
 * window of per-epoch returns.
 *
 * Outputs:
 *   • observed window stats (mean per-epoch return, sigma)
 *   • projection: { mean, p10, p90 } cumulative MON + USD by day
 *   • backtest: what the user's stake WOULD have earned across the lookback
 *
 * Note: assumes user's added stake is small relative to total pool (no
 * dilution model — over-counting is < 1% even at 1% pool entry).
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
  const stakeMon = Math.max(0, Number(url.searchParams.get("stakeMon") || "0") || 0);
  const horizonDays = Math.min(
    Math.max(1, Number(url.searchParams.get("horizonDays") || "365") || 365),
    1825 // 5 years cap
  );
  const lookback = Math.min(
    Math.max(7, Number(url.searchParams.get("lookback") || "60") || 60),
    365
  );

  if (stakeMon <= 0) {
    return NextResponse.json(
      { error: "stakeMon must be > 0" },
      { status: 400 }
    );
  }

  try {
    const snapshots = await db
      .select()
      .from(epochSnapshots)
      .where(eq(epochSnapshots.validatorId, validatorId))
      .orderBy(desc(epochSnapshots.epoch))
      .limit(lookback + 1);

    if (snapshots.length < 2) {
      return NextResponse.json({
        error: "Insufficient historical data for this validator",
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
    const latestPrice = priceMap.get(snapshots[0].epoch) ?? 0;

    const chronological = [...snapshots].reverse();
    const WEI = BigInt(10) ** BigInt(18);

    // Per-epoch realized DELEGATOR return for each epoch in the window.
    // Return = (delegator share of pool) / (delegator-side stake).
    // For a small added delegator, the marginal yield ≈ (1 - commission) ×
    // (poolRewardsMon / totalStakeMon).
    const perEpochReturns: number[] = [];
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
      const stakeMonPrev =
        Number(prevStakeWei / WEI) + Number(prevStakeWei % WEI) / Number(WEI);
      if (stakeMonPrev <= 0) continue;
      const commissionRate = Number(BigInt(curr.commission)) / 1e18;
      const delegatorPool = poolRewardsMon * (1 - commissionRate);
      const epochSpan = curr.epoch - prev.epoch;
      // Per-EPOCH return, normalized for span (so epochs missed by polling
      // don't double-weight). Stored as return-per-epoch.
      const ratePerEpoch = delegatorPool / stakeMonPrev / Math.max(1, epochSpan);
      perEpochReturns.push(ratePerEpoch);
      totalEpochSpan += epochSpan;
    }

    if (perEpochReturns.length === 0) {
      return NextResponse.json({
        error: "Could not compute per-epoch returns",
      });
    }

    const mean =
      perEpochReturns.reduce((s, x) => s + x, 0) / perEpochReturns.length;
    const variance =
      perEpochReturns.reduce((s, x) => s + (x - mean) ** 2, 0) /
      perEpochReturns.length;
    const sigma = Math.sqrt(variance);

    const EPOCHS_PER_DAY = 4.36;

    // Backtest: cumulative MON earned if user had `stakeMon` for the entire
    // lookback. Sum perEpochReturns × stakeMon (linearized — small-stake
    // assumption).
    const backtest: Array<{
      epoch: number;
      cumulativeMon: number;
      cumulativeUsd: number;
    }> = [];
    let cum = 0;
    let cumUsd = 0;
    for (let i = 1; i < chronological.length; i++) {
      const r = perEpochReturns[i - 1];
      if (r == null) continue;
      const epochSpan = chronological[i].epoch - chronological[i - 1].epoch;
      const earned = r * stakeMon * epochSpan;
      cum += earned;
      const p = priceMap.get(chronological[i].epoch) ?? latestPrice;
      cumUsd += earned * p;
      backtest.push({
        epoch: chronological[i].epoch,
        cumulativeMon: cum,
        cumulativeUsd: cumUsd,
      });
    }

    // Projection: mean ± 1σ band over horizonDays (sample mean, not single
    // path). We treat days as i.i.d. sums of EPOCHS_PER_DAY epochs; for
    // the SUM of N i.i.d. variables, sigma scales as √N.
    const projection: Array<{
      day: number;
      meanMon: number;
      p10Mon: number;
      p90Mon: number;
      meanUsd: number;
      p10Usd: number;
      p90Usd: number;
    }> = [];
    for (let d = 1; d <= horizonDays; d++) {
      const epochsElapsed = d * EPOCHS_PER_DAY;
      const expectedReturn = mean * epochsElapsed;
      const stdReturn = sigma * Math.sqrt(epochsElapsed);
      const meanMon = expectedReturn * stakeMon;
      // ~1.2816σ ≈ p10/p90 for normal; we use 1σ for simpler "1σ band"
      // as svt.one uses no variance at all — anything is an upgrade.
      const sigmaMon = stdReturn * stakeMon;
      const p10Mon = meanMon - 1.2816 * sigmaMon;
      const p90Mon = meanMon + 1.2816 * sigmaMon;
      projection.push({
        day: d,
        meanMon,
        p10Mon,
        p90Mon,
        meanUsd: meanMon * latestPrice,
        p10Usd: p10Mon * latestPrice,
        p90Usd: p90Mon * latestPrice,
      });
    }

    const apyMean = mean * EPOCHS_PER_DAY * 365 * 100;
    const apyP10 = (mean - 1.2816 * sigma) * EPOCHS_PER_DAY * 365 * 100;
    const apyP90 = (mean + 1.2816 * sigma) * EPOCHS_PER_DAY * 365 * 100;

    const response = NextResponse.json({
      validatorId,
      input: { stakeMon, horizonDays, lookback },
      observed: {
        epochCount: perEpochReturns.length,
        epochSpan: totalEpochSpan,
        approxDays: totalEpochSpan / EPOCHS_PER_DAY,
        meanReturnPerEpoch: mean,
        sigmaReturnPerEpoch: sigma,
        latestMonPriceUsd: latestPrice,
      },
      apy: { mean: apyMean, p10: apyP10, p90: apyP90 },
      backtest,
      projection,
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
