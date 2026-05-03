import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  epochPriorityFees,
  minerAliases,
  validators,
  networkEpochs,
} from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { getLiveMonPrice } from "@/lib/price";

/**
 * GET /api/mev?lookback=30
 *
 * Network-wide priority-fee analytics from the block-level indexer.
 *
 * Three views:
 *   1. networkSeries — per-epoch totals (fees MON, USD, blocks)
 *   2. validatorLeaderboard — top N validators by priority fees in window
 *   3. unmappedMiners — miner addresses producing blocks but not yet
 *      attributed to a validator (operator action item)
 *
 * USD math note: historical `network_epochs.mon_price_usd` rows were
 * stamped before the price-refresh cron came online, so most older epochs
 * have stale or zero prices. Network-wide USD totals therefore use the
 * CURRENT live MON price × total MON fees (consistent with how a CFO
 * would value lifetime earnings — at today's price). Per-epoch USD also
 * falls back to live price when historical price is missing/zero.
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

    // Historical prices (best-effort — many will be 0).
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

    // Live price — single source of truth for any USD valuation. Used both
    // as the network-totals multiplier AND as the per-epoch fallback.
    const live = await getLiveMonPrice().catch(() => ({ price: 0 }));
    const livePrice = (live as { price: number }).price || 0;

    const WEI = BigInt(10) ** BigInt(18);
    const networkSeries = networkRows.map((r) => {
      const wei = BigInt(r.feesWei || "0");
      const feesMon =
        Number(wei / WEI) + Number(wei % WEI) / Number(WEI);
      const histPrice = priceMap.get(r.epoch) ?? 0;
      const price = histPrice > 0 ? histPrice : livePrice;
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
          feesUsd: feesMon * livePrice,
          blocks: Number(r.blocks || 0),
          avgFeePerBlockMon:
            r.blocks > 0 ? feesMon / Number(r.blocks) : 0,
          shareOfNetwork:
            totalNetworkFeesMon > 0 ? feesMon / totalNetworkFeesMon : 0,
        };
      })
      .sort((a, b) => b.feesMon - a.feesMon)
      .slice(0, limit);

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
        feesUsd: feesMon * livePrice,
        blocks: Number(r.blocks || 0),
      };
    });

    const totalNetworkBlocks = networkSeries.reduce(
      (s, r) => s + r.blocks,
      0
    );
    // Network-wide USD = live MON price × total MON. This is the "what
    // would these fees be worth at today's market price" view, which
    // matches how operators think about their take. Per-epoch USD in
    // networkSeries can use historical price when available for charting.
    const totalNetworkUsd = totalNetworkFeesMon * livePrice;

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
        latestMonPriceUsd: livePrice,
      },
      networkSeries,
      validatorLeaderboard,
      unmappedMiners,
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=120, stale-while-revalidate=300"
    );
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
