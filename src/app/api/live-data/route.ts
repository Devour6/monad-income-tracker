import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { networkEpochs, validators as validatorsTable } from "@/lib/db/schema";
import { desc, sql } from "drizzle-orm";
import { getMonPrice } from "@/lib/monad-rpc";
import {
  DEFAULT_MON_PRICE,
  DEFAULT_TOTAL_STAKED,
  DEFAULT_ACTIVE_VALIDATORS,
} from "@/lib/constants";

export const revalidate = 300; // ISR: revalidate every 5 minutes

export async function GET() {
  const defaults = {
    monPrice: DEFAULT_MON_PRICE,
    networkStake: DEFAULT_TOTAL_STAKED,
    activeValidators: DEFAULT_ACTIVE_VALIDATORS,
    updatedAt: null,
  };

  try {
    // Read from DB (populated by cron) instead of making 200+ RPC calls
    const [latestEpoch, stakeAgg, monPrice] = await Promise.all([
      db
        .select()
        .from(networkEpochs)
        .orderBy(desc(networkEpochs.epoch))
        .limit(1),
      db
        .select({
          totalStake: sql<string>`coalesce(sum(${validatorsTable.stakeMon}), '0')`,
          count: sql<number>`count(*)`,
        })
        .from(validatorsTable),
      getMonPrice(),
    ]);

    const epoch = latestEpoch[0];
    const agg = stakeAgg[0];

    return NextResponse.json({
      monPrice: monPrice > 0 ? monPrice : (epoch ? Number(epoch.monPriceUsd) || defaults.monPrice : defaults.monPrice),
      networkStake: epoch ? Math.round(Number(epoch.totalStakeMon)) : (agg ? Math.round(Number(agg.totalStake)) : defaults.networkStake),
      activeValidators: epoch?.activeValidators ?? agg?.count ?? defaults.activeValidators,
      updatedAt: epoch?.createdAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.error(
      "Live data fetch error:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(defaults);
  }
}
