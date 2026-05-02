import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validators, networkEpochs } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { getRealizedIncomeBatch } from "@/lib/realized-income";

/**
 * GET /api/v1/realized/leaderboard
 *
 * Validators ranked by REALIZED lifetime commission income — the actual MON
 * they have collected, computed via the unclaimed_rewards delta + claim
 * detection method (see src/lib/realized-income.ts).
 *
 * This is the source of truth for "how much has each validator earned"
 * and matches treasury accounting (verified vs CFO ground truth).
 *
 * Query params:
 *   limit  — max validators to return (default 50, cap 250)
 *   sort   — total | unclaimed | claimed | claims  (default total)
 *
 * Response:
 *   {
 *     window: { firstEpoch, lastEpoch, daysObserved },
 *     validators: [
 *       {
 *         validatorId, name, authAddress, stakeMon, commissionPct,
 *         firstEpoch, lastEpoch, snapshotCount,
 *         totalCommissionMon, totalCommissionUsd,
 *         currentUnclaimedMon, totalClaimedMon, claimCount
 *       }
 *     ],
 *     monPriceUsd, generatedAt
 *   }
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitRaw = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit = Math.min(
      Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50,
      250
    );
    const sort = url.searchParams.get("sort") ?? "total";

    const allValidators = await db
      .select()
      .from(validators)
      .orderBy(desc(validators.stakeMon));

    const ids = allValidators.map((v) => v.validatorId);
    const realized = await getRealizedIncomeBatch(ids);

    const [latestPriceRow] = await db
      .select()
      .from(networkEpochs)
      .orderBy(desc(networkEpochs.epoch))
      .limit(1);
    const monPriceUsd = latestPriceRow
      ? Number(latestPriceRow.monPriceUsd) || 0
      : 0;

    const enriched = allValidators.map((v) => {
      const r = realized.get(v.validatorId)!;
      return {
        validatorId: v.validatorId,
        name: v.name ?? `Validator #${v.validatorId}`,
        authAddress: v.authAddress,
        stakeMon: Number(v.stakeMon) || 0,
        commissionPct: Number(v.commissionPct) || 0,
        firstEpoch: r.firstEpoch,
        lastEpoch: r.lastEpoch,
        snapshotCount: r.snapshotCount,
        totalCommissionMon: r.totalCommissionMon,
        totalCommissionUsd: r.totalCommissionMon * monPriceUsd,
        currentUnclaimedMon: r.currentUnclaimedMon,
        currentUnclaimedUsd: r.currentUnclaimedMon * monPriceUsd,
        totalClaimedMon: r.totalClaimedMon,
        totalClaimedUsd: r.totalClaimedMon * monPriceUsd,
        claimCount: r.claimCount,
      };
    });

    // Sort by selected key, descending. Tie-break on stake.
    const sortKey: keyof (typeof enriched)[number] =
      sort === "unclaimed"
        ? "currentUnclaimedMon"
        : sort === "claimed"
          ? "totalClaimedMon"
          : sort === "claims"
            ? "claimCount"
            : "totalCommissionMon";
    enriched.sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number;
      const bv = (b[sortKey] ?? 0) as number;
      if (av !== bv) return bv - av;
      return b.stakeMon - a.stakeMon;
    });

    const top = enriched.slice(0, limit);

    // Window — derived from any non-empty validator's range
    let firstEpoch: number | null = null;
    let lastEpoch: number | null = null;
    for (const v of enriched) {
      if (v.firstEpoch != null) {
        firstEpoch =
          firstEpoch == null ? v.firstEpoch : Math.min(firstEpoch, v.firstEpoch);
      }
      if (v.lastEpoch != null) {
        lastEpoch =
          lastEpoch == null ? v.lastEpoch : Math.max(lastEpoch, v.lastEpoch);
      }
    }
    const daysObserved =
      firstEpoch != null && lastEpoch != null
        ? (lastEpoch - firstEpoch) / 4.36
        : 0;

    const response = NextResponse.json({
      window: { firstEpoch, lastEpoch, daysObserved },
      validators: top,
      count: top.length,
      totalValidators: enriched.length,
      monPriceUsd,
      generatedAt: new Date().toISOString(),
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=120, stale-while-revalidate=300"
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
