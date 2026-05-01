import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  epochSnapshots,
  networkEpochs,
  epochPriorityFees,
  minerAliases,
} from "@/lib/db/schema";
import { eq, desc, inArray, sql } from "drizzle-orm";
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
  const rawEpochs = parseInt(url.searchParams.get("epochs") || "30", 10);
  const epochCount = Math.min(
    Math.max(isNaN(rawEpochs) ? 30 : rawEpochs, 1),
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

    // Real priority-fee data sourced from the block-level indexer.
    // Sums across every miner_address mapped to this validator_id, grouped
    // by epoch. Returns wei sums; we convert to MON in the loop below.
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
        sql`${minerAliases.validatorId} = ${validatorId} AND ${epochPriorityFees.epoch} IN ${epochIds.length > 0 ? epochIds : [0]}`
      )
      .groupBy(epochPriorityFees.epoch)) as unknown as {
      epoch: number;
      feesWei: string;
      blocks: number;
    }[];

    const priorityFeesByEpoch = new Map<
      number,
      { feesWei: bigint; blocks: number }
    >();
    for (const r of priorityFeeRows) {
      priorityFeesByEpoch.set(r.epoch, {
        feesWei: BigInt(r.feesWei || "0"),
        blocks: Number(r.blocks || 0),
      });
    }

    // Network-wide block totals per epoch — needed to compute production
    // efficiency = actualBlocks / expectedBlocks where expected is the
    // validator's stake share × epoch total. Only includes epochs the indexer
    // has touched, so missing entries fall back to "no efficiency data".
    const networkBlockRows = (await db
      .select({
        epoch: epochPriorityFees.epoch,
        totalBlocks: sql<number>`SUM(${epochPriorityFees.blocksProposed})`,
      })
      .from(epochPriorityFees)
      .where(
        sql`${epochPriorityFees.epoch} IN ${
          epochIds.length > 0 ? epochIds : [0]
        }`
      )
      .groupBy(epochPriorityFees.epoch)) as unknown as {
      epoch: number;
      totalBlocks: number;
    }[];
    const networkBlocksByEpoch = new Map<number, number>();
    for (const r of networkBlockRows) {
      networkBlocksByEpoch.set(r.epoch, Number(r.totalBlocks || 0));
    }

    // Total network stake at each epoch — sum of stake_wei across all
    // snapshots for that epoch. Pre-fetch so we can compute efficiency
    // without N+1 queries.
    const networkStakeRows = (await db
      .select({
        epoch: epochSnapshots.epoch,
        totalStakeWei: sql<string>`SUM(CAST(${epochSnapshots.stakeWei} AS NUMERIC))::TEXT`,
      })
      .from(epochSnapshots)
      .where(
        sql`${epochSnapshots.epoch} IN ${
          epochIds.length > 0 ? epochIds : [0]
        }`
      )
      .groupBy(epochSnapshots.epoch)) as unknown as {
      epoch: number;
      totalStakeWei: string;
    }[];
    const networkStakeByEpoch = new Map<number, bigint>();
    for (const r of networkStakeRows) {
      networkStakeByEpoch.set(r.epoch, BigInt(r.totalStakeWei || "0"));
    }

    const chronological = [...snapshots].reverse();

    const incomeHistory: Array<{
      epoch: number;
      epochSpan: number;
      poolRewardsMon: number;
      commissionMon: number;
      delegatorRewardsMon: number;
      selfStakeRewardsMon: number;
      priorityFeesMon: number | null;
      priorityFeeBlocks: number;
      // Production efficiency = actualBlocks / expectedBlocks where
      // expectedBlocks = epochTotalBlocks × (validatorStake / networkStake).
      // 1.00 = perfect proportional production, > 1 = overperforming, < 1 =
      // underperforming. Null when the indexer hasn't covered this epoch.
      productionEfficiency: number | null;
      expectedBlocks: number | null;
      validatorTotalMon: number;
      poolRewardsUsd: number;
      commissionUsd: number;
      priorityFeesUsd: number | null;
      validatorTotalUsd: number;
      stakeMon: number;
      selfStakeMon: number | null;
      commissionPct: number;
      monPriceUsd: number;
      timestamp: string;
    }> = [];

    let totalPoolRewards = 0;
    let totalCommission = 0;
    let totalSelfStakeRewards = 0;
    let totalPriorityFees = 0;
    let totalValidatorIncome = 0;
    let totalEpochSpan = 0;
    let hasSelfStakeData = false;
    let hasPriorityFeeData = false;
    let totalActualBlocks = 0;
    let totalExpectedBlocks = 0;
    let hasProductionData = false;

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

      const WEI = BigInt(10) ** BigInt(18);
      const stakeWei = BigInt(curr.stakeWei);
      const stakeMon =
        Number(stakeWei / WEI) + Number(stakeWei % WEI) / Number(WEI);

      // Self-stake share: validator's portion of the delegator pool earned on
      // their own self-delegated stake. Uses the PREVIOUS epoch's self-stake
      // (same logic as using prev.stakeWei for pool rewards — that's the
      // stake that earned this epoch's rewards).
      let selfStakeMon: number | null = null;
      let selfStakeRewardsMon = 0;
      if (prev.selfStakeWei != null) {
        hasSelfStakeData = true;
        const prevSelfStakeWei = BigInt(prev.selfStakeWei);
        selfStakeMon =
          Number(prevSelfStakeWei / WEI) +
          Number(prevSelfStakeWei % WEI) / Number(WEI);
        if (prevStakeWei > BigInt(0) && delegatorRewardsMon > 0) {
          // share = selfStake / totalStake — compute with BigInt ratio for
          // precision then scale
          const RATIO_SCALE = BigInt(10) ** BigInt(18);
          const shareScaled = (prevSelfStakeWei * RATIO_SCALE) / prevStakeWei;
          const share = Number(shareScaled) / Number(RATIO_SCALE);
          selfStakeRewardsMon = delegatorRewardsMon * share;
        }
      }

      // Priority fees: REAL block-level data from epoch_priority_fees,
      // computed as sum over every block produced by this validator's
      // miner_address(es) of:
      //   sum_tx( gasUsed × (effectiveGasPrice − baseFeePerGas) )
      //
      // Attributed to the curr.epoch — that's the epoch in which the
      // blocks were proposed and fees received. Returns null when the
      // indexer hasn't covered this epoch yet (in-progress or pre-indexer
      // history).
      let priorityFeesMon: number | null = null;
      let priorityFeeBlocks = 0;
      const pf = priorityFeesByEpoch.get(curr.epoch);
      if (pf && pf.blocks > 0) {
        hasPriorityFeeData = true;
        priorityFeesMon =
          Number(pf.feesWei / WEI) + Number(pf.feesWei % WEI) / Number(WEI);
        priorityFeeBlocks = pf.blocks;
      }

      const validatorTotalMon =
        commissionMon + selfStakeRewardsMon + (priorityFeesMon ?? 0);

      // Production efficiency — only meaningful when we have indexer
      // coverage AND the validator has stake at this epoch.
      let productionEfficiency: number | null = null;
      let expectedBlocks: number | null = null;
      const epochTotalBlocks = networkBlocksByEpoch.get(curr.epoch);
      const epochTotalStakeWei = networkStakeByEpoch.get(curr.epoch);
      if (
        epochTotalBlocks &&
        epochTotalStakeWei &&
        epochTotalStakeWei > BigInt(0) &&
        prevStakeWei > BigInt(0)
      ) {
        const RATIO_SCALE = BigInt(10) ** BigInt(18);
        const shareScaled =
          (prevStakeWei * RATIO_SCALE) / epochTotalStakeWei;
        const stakeShare = Number(shareScaled) / Number(RATIO_SCALE);
        expectedBlocks = epochTotalBlocks * stakeShare;
        if (expectedBlocks > 0) {
          productionEfficiency = priorityFeeBlocks / expectedBlocks;
          hasProductionData = true;
          totalActualBlocks += priorityFeeBlocks;
          totalExpectedBlocks += expectedBlocks;
        }
      }

      const monPrice = priceMap.get(curr.epoch) || 0;
      const epochSpan = curr.epoch - prev.epoch;

      totalPoolRewards += poolRewardsMon;
      totalCommission += commissionMon;
      totalSelfStakeRewards += selfStakeRewardsMon;
      if (priorityFeesMon != null) totalPriorityFees += priorityFeesMon;
      totalValidatorIncome += validatorTotalMon;
      totalEpochSpan += epochSpan;

      incomeHistory.push({
        epoch: curr.epoch,
        epochSpan,
        poolRewardsMon,
        commissionMon,
        delegatorRewardsMon,
        selfStakeRewardsMon,
        priorityFeesMon,
        priorityFeeBlocks,
        productionEfficiency,
        expectedBlocks,
        validatorTotalMon,
        poolRewardsUsd: poolRewardsMon * monPrice,
        commissionUsd: commissionMon * monPrice,
        priorityFeesUsd:
          priorityFeesMon != null ? priorityFeesMon * monPrice : null,
        validatorTotalUsd: validatorTotalMon * monPrice,
        stakeMon,
        selfStakeMon,
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
    const avgSelfStakePerEpoch =
      totalEpochSpan > 0 ? totalSelfStakeRewards / totalEpochSpan : 0;
    const avgPriorityFeesPerEpoch =
      totalEpochSpan > 0 ? totalPriorityFees / totalEpochSpan : 0;
    const avgValidatorPerEpoch =
      totalEpochSpan > 0 ? totalValidatorIncome / totalEpochSpan : 0;

    const latestPrice = incomeHistory.length > 0
      ? incomeHistory[incomeHistory.length - 1].monPriceUsd
      : 0;

    const totalPoolUsd = incomeHistory.reduce((s, e) => s + e.poolRewardsUsd, 0);
    const totalCommissionUsd = incomeHistory.reduce((s, e) => s + e.commissionUsd, 0);
    const totalValidatorUsd = incomeHistory.reduce((s, e) => s + e.validatorTotalUsd, 0);
    const totalPriorityFeesUsd = incomeHistory.reduce(
      (s, e) => s + (e.priorityFeesUsd ?? 0),
      0
    );

    // Latest self-stake (for headline display)
    const latestSnap = chronological[chronological.length - 1];
    const WEI = BigInt(10) ** BigInt(18);
    let currentSelfStakeMon: number | null = null;
    if (latestSnap?.selfStakeWei != null) {
      const sw = BigInt(latestSnap.selfStakeWei);
      currentSelfStakeMon = Number(sw / WEI) + Number(sw % WEI) / Number(WEI);
    }

    // ─── APY decomposition ─────────────────────────────────────────────────
    // Four lenses on yield, all annualized from the observed window:
    //
    //   poolApy           — pool rewards / total pool stake (before
    //                       commission). The headline "vote-credit APY".
    //   delegatorApy      — pool × (1 − commission_rate); what a delegator
    //                       nets after the validator's cut. On Monad,
    //                       priority fees flow to the miner address, so
    //                       delegators don't share in MEV today.
    //   validatorCapitalApy — yield on the validator's OWN stake from the
    //                       precompile pool + priority fees (i.e. setting
    //                       commission aside, what does the company earn
    //                       on capital it actually has at risk).
    //   commissionYieldApy — commission + priority fees / TOTAL stake.
    //                       Network-level extraction rate; useful for
    //                       comparing "tax burden" across validators.
    //
    // We deliberately avoid a "Total APY on self-stake" headline because
    // commission income is leverage on OUTSIDE capital, not yield on
    // self-stake. Conflating them inflates the number into nonsense (a
    // 100K-self-stake validator earning $35K commission/12d would print as
    // ~1000% APY which is mathematically true but materially misleading).
    let poolApy: number | null = null;
    let delegatorApy: number | null = null;
    let validatorCapitalApy: number | null = null;
    let commissionYieldApy: number | null = null;
    if (totalEpochSpan > 0 && incomeHistory.length > 0) {
      const latestStakeMon =
        latestSnap?.stakeWei != null
          ? Number(BigInt(latestSnap.stakeWei) / WEI) +
            Number(BigInt(latestSnap.stakeWei) % WEI) / Number(WEI)
          : 0;
      if (latestStakeMon > 0) {
        const perEpochPoolReturn =
          totalPoolRewards / latestStakeMon / totalEpochSpan;
        poolApy = perEpochPoolReturn * EPOCHS_PER_YEAR * 100;
        const effCommissionRate =
          totalPoolRewards > 0 ? totalCommission / totalPoolRewards : 0;
        delegatorApy = poolApy * (1 - effCommissionRate);
        const commissionPlusMev =
          totalCommission + (hasPriorityFeeData ? totalPriorityFees : 0);
        const perEpochCommYield =
          commissionPlusMev / latestStakeMon / totalEpochSpan;
        commissionYieldApy = perEpochCommYield * EPOCHS_PER_YEAR * 100;
      }
      if (
        hasSelfStakeData &&
        currentSelfStakeMon != null &&
        currentSelfStakeMon > 0
      ) {
        // Yield on validator's own capital = pool yield on their self-stake
        // share + priority fees attributed to self-stake share.
        // We use selfStakeRewardsMon (already self-stake's portion of the
        // delegator pool) + a proportional slice of priority fees.
        const selfShareOfFees = hasPriorityFeeData
          ? totalPriorityFees * (currentSelfStakeMon / latestStakeMon)
          : 0;
        const capitalIncome = totalSelfStakeRewards + selfShareOfFees;
        const perEpochCapReturn =
          capitalIncome / currentSelfStakeMon / totalEpochSpan;
        validatorCapitalApy = perEpochCapReturn * EPOCHS_PER_YEAR * 100;
      }
    }

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
          // Validator company's true realized income: commission + their share
          // of the delegator pool earned on their own self-stake.
          // Null when we don't have self-stake data yet (historical rows).
          selfStakeRewardsMon: hasSelfStakeData ? totalSelfStakeRewards : null,
          priorityFeesMon: hasPriorityFeeData ? totalPriorityFees : null,
          priorityFeesUsd: hasPriorityFeeData ? totalPriorityFeesUsd : null,
          validatorTotalMon: hasSelfStakeData ? totalValidatorIncome : null,
          validatorTotalUsd: hasSelfStakeData ? totalValidatorUsd : null,
          currentSelfStakeMon,
          firstEpoch: incomeHistory[0]?.epoch ?? null,
          lastEpoch: incomeHistory[incomeHistory.length - 1]?.epoch ?? null,
          // Block production efficiency over the observed window.
          // 1.0 = exactly proportional to stake, > 1 over, < 1 under.
          actualBlocks: hasProductionData ? totalActualBlocks : null,
          expectedBlocks: hasProductionData ? totalExpectedBlocks : null,
          productionEfficiency:
            hasProductionData && totalExpectedBlocks > 0
              ? totalActualBlocks / totalExpectedBlocks
              : null,
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
          // Validator company rates (commission + self-stake share) — only
          // meaningful once we have at least one epoch with self-stake data.
          validatorPerEpochMon: hasSelfStakeData ? avgValidatorPerEpoch : null,
          validatorPerDayMon: hasSelfStakeData ? avgValidatorPerEpoch * EPOCHS_PER_DAY : null,
          validatorPerMonthMon: hasSelfStakeData ? avgValidatorPerEpoch * EPOCHS_PER_DAY * 30 : null,
          validatorPerYearMon: hasSelfStakeData ? avgValidatorPerEpoch * EPOCHS_PER_YEAR : null,
          validatorPerDayUsd: hasSelfStakeData ? avgValidatorPerEpoch * EPOCHS_PER_DAY * latestPrice : null,
          validatorPerMonthUsd: hasSelfStakeData ? avgValidatorPerEpoch * EPOCHS_PER_DAY * 30 * latestPrice : null,
          validatorPerYearUsd: hasSelfStakeData ? avgValidatorPerEpoch * EPOCHS_PER_YEAR * latestPrice : null,
          avgSelfStakePerEpochMon: hasSelfStakeData ? avgSelfStakePerEpoch : null,
          // Priority-fee rates — REAL per-block fees from the indexer
          // (sum_tx(gasUsed × (effGasPrice − baseFee))) attributed to the
          // validator via miner_aliases. Null when indexer hasn't indexed
          // the relevant epochs yet.
          priorityFeesPerEpochMon: hasPriorityFeeData ? avgPriorityFeesPerEpoch : null,
          priorityFeesPerDayMon: hasPriorityFeeData ? avgPriorityFeesPerEpoch * EPOCHS_PER_DAY : null,
          priorityFeesPerMonthMon: hasPriorityFeeData ? avgPriorityFeesPerEpoch * EPOCHS_PER_DAY * 30 : null,
          priorityFeesPerYearMon: hasPriorityFeeData ? avgPriorityFeesPerEpoch * EPOCHS_PER_YEAR : null,
          priorityFeesPerDayUsd: hasPriorityFeeData ? avgPriorityFeesPerEpoch * EPOCHS_PER_DAY * latestPrice : null,
          priorityFeesPerMonthUsd: hasPriorityFeeData ? avgPriorityFeesPerEpoch * EPOCHS_PER_DAY * 30 * latestPrice : null,
          priorityFeesPerYearUsd: hasPriorityFeeData ? avgPriorityFeesPerEpoch * EPOCHS_PER_YEAR * latestPrice : null,
        },
        apy: {
          poolApy,
          delegatorApy,
          validatorCapitalApy,
          commissionYieldApy,
        },
        hasSelfStakeData,
        hasPriorityFeeData,
        hasProductionData,
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
