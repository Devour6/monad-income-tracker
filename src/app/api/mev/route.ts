import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  epochPriorityFees,
  minerAliases,
  validators,
  networkEpochs,
} from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";

/**
 * GET /api/mev?lookback=30
 *
 * Network-wide MEV / priority-fee analytics, sourced from the block-level
 * indexer. Three views:
 *
 *   1. networkSeries — per-epoch totals (fees MON, USD, blocks)
 *   2. validatorLeaderboard — top N validators by priority fees in window,
 *      with per-block average and share of total
 *   3. unmappedMiners — miner addresses producing blocks but NOT yet
 *      attributed to a validatorId (operator action item)
 *
 * The query joins miner_aliases for attribution; rows where there is no
 * alias still appear in `unmappedMiners` so we can surface them.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const lookback = Math.min(
    Math.max(1, Number(url.searchParams.get("lookback") || "30") || 30),
    180
  );
  const limit = Math.min(
    Math.max(5, Number(url.searchParams.get("limit") || "50") || 50),
    200
  );

  try {
    // Find the highest indexed epoch.
    const latestRow = (await db
      .select({ maxEpoch: sql<number>`MAX(${epochPriorityFees.epoch})` })
      .from(epochPriorityFees)) as unknown as { maxEpoch: number | null }[];
    const latestEpoch = latestRow[0]?.maxEpoch ?? null;

    if (latestEpoch == null) {
      return NextResponse.json({
        window: null,
        networkSeries: [],
        validatorLeaderboard: [],
        unmappedMiners: [],
      });
    }

    const fromEpoch = latestEpoch - lookback + 1;

    // Per-epoch network totals.
    const networkRows = (await db
      .select({
        epoch: epochPriorityFees.epoch,
        feesWei: sql<string>`SUM(CAST(${epochPriorityFees.priorityFeesWei} AS NUMERIC))::TEXT`,
        blocks: sql<number>`SUM(${epochPriorityFees.blocksProposed})`,
      })
      .from(epochPriorityFees)
      .where(sql`${epochPriorityFees.epoch} >= ${fromEpoch}`)
      .groupBy(epochPriorityFees.epoch)
      .orderBy(epochPriorityFees.epoch)) as unknown as {
      epoch: number;
      feesWei: string;
      blocks: number;
    }[];

    // Prices for those epochs.
    const epochList = networkRows.map((r) => r.epoch);
    const priceRows =
      epochList.length > 0
        ? await db
            .select()
            .from(networkEpochs)
            .where(sql`${networkEpochs.epoch} IN ${epochList}`)
        : [];
    const priceMap = new Map<number, number>();
    for (const p of priceRows) {
      priceMap.set(p.epoch, Number(p.monPriceUsd) || 0);
    }
    const latestPrice =
      [...priceMap.values()].reverse().find((p) => p > 0) ?? 0;

    const WEI = BigInt(10) ** BigInt(18);
    const networkSeries = networkRows.map((r) => {
      const wei = BigInt(r.feesWei || "0");
      const feesMon =
        Number(wei / WEI) + Number(wei % WEI) / Number(WEI);
      const price = priceMap.get(r.epoch) ?? 0;
      return {
        epoch: r.epoch,
        feesMon,
        feesUsd: feesMon * price,
        blocks: Number(r.blocks || 0),
        avgFeePerBlockMon:
          r.blocks > 0 ? feesMon / Number(r.blocks) : 0,
        monPriceUsd: price,
      };
    });

    // Validator leaderboard for the window (mapped miners only).
    const leaderboardRows = (await db
      .select({
        validatorId: minerAliases.validatorId,
        feesWei: sql<string>`SUM(CAST(${epochPriorityFees.priorityFeesWei} AS NUMERIC))::TEXT`,
        blocks: sql<number>`SUM(${epochPriorityFees.blocksProposed})`,
      })
      .from(epochPriorityFees)
      .innerJoin(
        minerAliases,
        eq(minerAliases.minerAddress, epochPriorityFees.minerAddress)
      )
      .where(sql`${epochPriorityFees.epoch} >= ${fromEpoch}`)
      .groupBy(minerAliases.validatorId)) as unknown as {
      validatorId: number;
      feesWei: string;
      blocks: number;
    }[];

    const totalNetworkFeesMon = networkSeries.reduce(
      (s, r) => s + r.feesMon,
      0
    );

    // Resolve validator names.
    const ids = leaderboardRows.map((r) => r.validatorId);
    const nameRows =
      ids.length > 0
        ? await db
            .select({
              validatorId: validators.validatorId,
              name: validators.name,
              authAddress: validators.authAddress,
              commissionPct: validators.commissionPct,
              stakeMon: validators.stakeMon,
            })
            .from(validators)
            .where(sql`${validators.validatorId} IN ${ids}`)
        : [];
    const nameMap = new Map<
      number,
      { name: string | null; authAddress: string; commissionPct: string | null; stakeMon: string | null }
    >();
    for (const n of nameRows) {
      nameMap.set(n.validatorId, {
        name: n.name,
        authAddress: n.authAddress,
        commissionPct: n.commissionPct,
        stakeMon: n.stakeMon,
      });
    }

    const validatorLeaderboard = leaderboardRows
      .map((r) => {
        const wei = BigInt(r.feesWei || "0");
        const feesMon =
          Number(wei / WEI) + Number(wei % WEI) / Number(WEI);
        const meta = nameMap.get(r.validatorId);
        return {
          validatorId: r.validatorId,
          name: meta?.name || `Validator #${r.validatorId}`,
          authAddress: meta?.authAddress ?? null,
          commissionPct: meta?.commissionPct ? Number(meta.commissionPct) : null,
          stakeMon: meta?.stakeMon ? Number(meta.stakeMon) : null,
          feesMon,
          feesUsd: feesMon * latestPrice,
          blocks: Number(r.blocks || 0),
          avgFeePerBlockMon:
            r.blocks > 0 ? feesMon / Number(r.blocks) : 0,
          shareOfNetwork:
            totalNetworkFeesMon > 0 ? feesMon / totalNetworkFeesMon : 0,
        };
      })
      .sort((a, b) => b.feesMon - a.feesMon)
      .slice(0, limit);

    // Unmapped miners — produced blocks but no validator attribution yet.
    const unmappedRows = (await db
      .select({
        minerAddress: epochPriorityFees.minerAddress,
        feesWei: sql<string>`SUM(CAST(${epochPriorityFees.priorityFeesWei} AS NUMERIC))::TEXT`,
        blocks: sql<number>`SUM(${epochPriorityFees.blocksProposed})`,
      })
      .from(epochPriorityFees)
      .leftJoin(
        minerAliases,
        eq(minerAliases.minerAddress, epochPriorityFees.minerAddress)
      )
      .where(
        sql`${epochPriorityFees.epoch} >= ${fromEpoch} AND ${minerAliases.validatorId} IS NULL`
      )
      .groupBy(epochPriorityFees.minerAddress)
      .orderBy(
        desc(
          sql`SUM(CAST(${epochPriorityFees.priorityFeesWei} AS NUMERIC))`
        )
      )
      .limit(20)) as unknown as {
      minerAddress: string;
      feesWei: string;
      blocks: number;
    }[];

    const unmappedMiners = unmappedRows.map((r) => {
      const wei = BigInt(r.feesWei || "0");
      const feesMon =
        Number(wei / WEI) + Number(wei % WEI) / Number(WEI);
      return {
        minerAddress: r.minerAddress,
        feesMon,
        blocks: Number(r.blocks || 0),
      };
    });

    const totalNetworkBlocks = networkSeries.reduce(
      (s, r) => s + r.blocks,
      0
    );
    const totalNetworkUsd = networkSeries.reduce((s, r) => s + r.feesUsd, 0);

    const response = NextResponse.json({
      window: {
        fromEpoch,
        toEpoch: latestEpoch,
        epochSpan: latestEpoch - fromEpoch + 1,
        approxDays: (latestEpoch - fromEpoch + 1) / 4.36,
      },
      totals: {
        networkFeesMon: totalNetworkFeesMon,
        networkFeesUsd: totalNetworkUsd,
        networkBlocks: totalNetworkBlocks,
        avgFeePerBlockMon:
          totalNetworkBlocks > 0
            ? totalNetworkFeesMon / totalNetworkBlocks
            : 0,
        latestMonPriceUsd: latestPrice,
      },
      networkSeries,
      validatorLeaderboard,
      unmappedMiners,
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
