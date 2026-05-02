import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validators, networkEpochs } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { getRealizedIncomeBatch } from "@/lib/realized-income";

/**
 * GET /api/v1/realized/network
 *
 * Network-wide realized commission totals. Sums every validator's lifetime
 * commission as measured by the unclaimed_rewards delta + claim detection
 * method. This is "how much MON has the entire validator set actually
 * collected in commission across all of Monad's history we've indexed".
 */
export async function GET() {
  try {
    const allValidators = await db.select().from(validators);
    const ids = allValidators.map((v) => v.validatorId);
    const realized = await getRealizedIncomeBatch(ids);

    let totalCommissionMon = 0;
    let totalUnclaimedMon = 0;
    let totalClaimedMon = 0;
    let totalClaimEvents = 0;
    let validatorsWithIncome = 0;
    let firstEpoch: number | null = null;
    let lastEpoch: number | null = null;

    for (const v of allValidators) {
      const r = realized.get(v.validatorId);
      if (!r) continue;
      totalCommissionMon += r.totalCommissionMon;
      totalUnclaimedMon += r.currentUnclaimedMon;
      totalClaimedMon += r.totalClaimedMon;
      totalClaimEvents += r.claimCount;
      if (r.totalCommissionMon > 0) validatorsWithIncome += 1;
      if (r.firstEpoch != null) {
        firstEpoch =
          firstEpoch == null ? r.firstEpoch : Math.min(firstEpoch, r.firstEpoch);
      }
      if (r.lastEpoch != null) {
        lastEpoch =
          lastEpoch == null ? r.lastEpoch : Math.max(lastEpoch, r.lastEpoch);
      }
    }

    const [latestPriceRow] = await db
      .select()
      .from(networkEpochs)
      .orderBy(desc(networkEpochs.epoch))
      .limit(1);
    const monPriceUsd = latestPriceRow
      ? Number(latestPriceRow.monPriceUsd) || 0
      : 0;

    const daysObserved =
      firstEpoch != null && lastEpoch != null
        ? (lastEpoch - firstEpoch) / 4.36
        : 0;

    const response = NextResponse.json({
      window: {
        firstEpoch,
        lastEpoch,
        daysObserved,
      },
      totals: {
        commissionMon: totalCommissionMon,
        commissionUsd: totalCommissionMon * monPriceUsd,
        currentUnclaimedMon: totalUnclaimedMon,
        currentUnclaimedUsd: totalUnclaimedMon * monPriceUsd,
        claimedMon: totalClaimedMon,
        claimedUsd: totalClaimedMon * monPriceUsd,
        claimEvents: totalClaimEvents,
      },
      counts: {
        validatorsTracked: allValidators.length,
        validatorsWithIncome,
      },
      monPriceUsd,
      generatedAt: new Date().toISOString(),
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=600"
    );
    response.headers.set("X-API-Version", "v1");
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
