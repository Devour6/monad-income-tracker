import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  validators,
  epochSnapshots,
  epochPriorityFees,
  minerAliases,
} from "@/lib/db/schema";
import { desc, sql, eq, inArray } from "drizzle-orm";
import { calculateEpochReward } from "@/lib/monad-rpc";

/**
 * GET /api/leaderboard
 *
 * Validator leaderboard for delegators. One row per validator with the
 * comparison fields a delegator actually needs:
 *
 *   - delegatorApy        — pool yield × (1 − commission). The single number
 *                           a delegator should optimize against.
 *   - poolApy             — gross pool yield before commission.
 *   - commissionPct       — current commission rate.
 *   - stakeMon            — total stake (proxy for trust + load).
 *   - selfStakeMon        — validator's skin in the game.
 *   - blocksProposed      — recent block production.
 *   - productionEfficiency — actual / expected blocks (1.0 = on-pace).
 *   - priorityFeesMon     — recent priority fee earnings (validator-side
 *                           signal that doesn't accrue to delegators today
 *                           but indicates how active the operator is).
 *
 * Computed over the last N epochs (default 7) of indexed data, so it
 * automatically widens as history accumulates. Returns nulls for fields
 * the indexer hasn't yet covered for a given validator.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const lookback = Math.min(
      Math.max(parseInt(url.searchParams.get("lookback") || "7", 10), 1),
      30,
    );

    // Determine which epochs to summarize over: the last `lookback` distinct
    // epochs we have snapshots for.
    const distinctEpochs = await db
      .selectDistinct({ epoch: epochSnapshots.epoch })
      .from(epochSnapshots)
      .orderBy(desc(epochSnapshots.epoch))
      .limit(lookback + 1);

    if (distinctEpochs.length < 2) {
      return NextResponse.json(
        { error: "Not enough snapshot epochs yet" },
        { status: 503 },
      );
    }

    const epochsAsc = distinctEpochs
      .map((d) => d.epoch)
      .sort((a, b) => a - b);
    const earliestEpoch = epochsAsc[0];
    const latestEpoch = epochsAsc[epochsAsc.length - 1];
    const epochSpan = latestEpoch - earliestEpoch;

    // 1. All validators (current metadata)
    const vRows = await db
      .select()
      .from(validators)
      .orderBy(desc(validators.stakeMon));

    // 2. Latest + earliest snapshot per validator within the window
    const allSnaps = await db
      .select()
      .from(epochSnapshots)
      .where(inArray(epochSnapshots.epoch, [earliestEpoch, latestEpoch]));

    const earliestByVid = new Map<number, (typeof allSnaps)[number]>();
    const latestByVid = new Map<number, (typeof allSnaps)[number]>();
    for (const s of allSnaps) {
      if (s.epoch === earliestEpoch) earliestByVid.set(s.validatorId, s);
      else if (s.epoch === latestEpoch) latestByVid.set(s.validatorId, s);
    }

    // 3. Priority fee + block totals per validator across the window
    const pfRows = (await db
      .select({
        validatorId: minerAliases.validatorId,
        feesWei: sql<string>`SUM(CAST(${epochPriorityFees.priorityFeesWei} AS NUMERIC))::TEXT`,
        blocks: sql<number>`SUM(${epochPriorityFees.blocksProposed})`,
      })
      .from(epochPriorityFees)
      .innerJoin(
        minerAliases,
        eq(minerAliases.minerAddress, epochPriorityFees.minerAddress),
      )
      .where(inArray(epochPriorityFees.epoch, epochsAsc))
      .groupBy(minerAliases.validatorId)) as unknown as {
      validatorId: number;
      feesWei: string;
      blocks: number;
    }[];

    const pfByVid = new Map<
      number,
      { feesMon: number; blocks: number }
    >();
    const WEI = BigInt(10) ** BigInt(18);
    for (const r of pfRows) {
      const wei = BigInt(r.feesWei || "0");
      pfByVid.set(r.validatorId, {
        feesMon:
          Number(wei / WEI) + Number(wei % WEI) / Number(WEI),
        blocks: Number(r.blocks || 0),
      });
    }

    // 4. Network totals for production efficiency
    const networkBlocksRow = await db
      .select({
        total: sql<number>`SUM(${epochPriorityFees.blocksProposed})`,
      })
      .from(epochPriorityFees)
      .where(inArray(epochPriorityFees.epoch, epochsAsc));
    const networkBlocks = Number(
      (networkBlocksRow[0]?.total as unknown as string) || 0,
    );

    const networkStakeRow = await db
      .select({
        total: sql<string>`SUM(CAST(${epochSnapshots.stakeWei} AS NUMERIC))::TEXT`,
      })
      .from(epochSnapshots)
      .where(eq(epochSnapshots.epoch, latestEpoch));
    const networkStakeWei = BigInt(networkStakeRow[0]?.total || "0");

    // 5. Build leaderboard rows
    const EPOCHS_PER_DAY = 4.36;
    const EPOCHS_PER_YEAR = EPOCHS_PER_DAY * 365;

    const out = vRows
      .map((v) => {
        const earliest = earliestByVid.get(v.validatorId);
        const latest = latestByVid.get(v.validatorId);
        const pf = pfByVid.get(v.validatorId);

        let poolApy: number | null = null;
        let delegatorApy: number | null = null;
        let commissionRate = Number(v.commissionPct) / 100;

        if (earliest && latest && epochSpan > 0) {
          const accOld = BigInt(earliest.accRewardPerToken);
          const accNew = BigInt(latest.accRewardPerToken);
          const stakeWei = BigInt(earliest.stakeWei);
          if (stakeWei > BigInt(0) && accNew > accOld) {
            const { totalRewardMon } = calculateEpochReward(
              accOld,
              accNew,
              stakeWei,
            );
            const stakeMon =
              Number(stakeWei / WEI) + Number(stakeWei % WEI) / Number(WEI);
            if (stakeMon > 0) {
              const perEpoch = totalRewardMon / stakeMon / epochSpan;
              poolApy = perEpoch * EPOCHS_PER_YEAR * 100;
              const liveCommRate =
                Number(BigInt(latest.commission)) / 1e18;
              commissionRate = liveCommRate;
              delegatorApy = poolApy * (1 - liveCommRate);
            }
          }
        }

        let selfStakeMon: number | null = null;
        if (latest?.selfStakeWei != null) {
          const sw = BigInt(latest.selfStakeWei);
          selfStakeMon =
            Number(sw / WEI) + Number(sw % WEI) / Number(WEI);
        }

        let productionEfficiency: number | null = null;
        if (
          pf &&
          pf.blocks > 0 &&
          networkBlocks > 0 &&
          networkStakeWei > BigInt(0) &&
          latest?.stakeWei
        ) {
          const stakeWei = BigInt(latest.stakeWei);
          const RATIO = BigInt(10) ** BigInt(18);
          const shareScaled = (stakeWei * RATIO) / networkStakeWei;
          const stakeShare = Number(shareScaled) / Number(RATIO);
          const expected = networkBlocks * stakeShare;
          if (expected > 0) productionEfficiency = pf.blocks / expected;
        }

        return {
          validatorId: v.validatorId,
          name: v.name || `Validator #${v.validatorId}`,
          authAddress: v.authAddress,
          stakeMon: Number(v.stakeMon) || 0,
          commissionPct: commissionRate * 100,
          selfStakeMon,
          poolApy,
          delegatorApy,
          blocksProposed: pf?.blocks ?? 0,
          priorityFeesMon: pf?.feesMon ?? 0,
          productionEfficiency,
        };
      })
      // Filter out validators with no income data — they're useless to a delegator
      .filter((row) => row.delegatorApy != null);

    const response = NextResponse.json({
      window: {
        earliestEpoch,
        latestEpoch,
        epochSpan,
        approxDays: epochSpan / EPOCHS_PER_DAY,
      },
      validators: out,
      count: out.length,
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=600",
    );
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
