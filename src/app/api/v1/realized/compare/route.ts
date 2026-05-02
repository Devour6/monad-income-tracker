import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validators, networkEpochs } from "@/lib/db/schema";
import { inArray, desc } from "drizzle-orm";
import { getRealizedIncomeBatch } from "@/lib/realized-income";

/**
 * GET /api/v1/realized/compare?ids=200,97,3
 *
 * Side-by-side realized income for a chosen set of validators. Same math as
 * /api/v1/validators/[id]/realized — uses unclaimed_rewards delta + claim
 * detection so numbers match the validators' treasury accounting.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const idsParam = url.searchParams.get("ids") ?? "";
    const ids = idsParam
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "Provide ?ids=1,2,3" },
        { status: 400 }
      );
    }

    const meta = await db
      .select()
      .from(validators)
      .where(inArray(validators.validatorId, ids));

    const realized = await getRealizedIncomeBatch(ids);

    const [latestPriceRow] = await db
      .select()
      .from(networkEpochs)
      .orderBy(desc(networkEpochs.epoch))
      .limit(1);
    const monPriceUsd = latestPriceRow
      ? Number(latestPriceRow.monPriceUsd) || 0
      : 0;

    const metaById = new Map(meta.map((m) => [m.validatorId, m]));
    const out = ids.map((id) => {
      const m = metaById.get(id);
      const r = realized.get(id)!;
      return {
        validatorId: id,
        name: m?.name ?? `Validator #${id}`,
        authAddress: m?.authAddress ?? null,
        stakeMon: Number(m?.stakeMon) || 0,
        commissionPct: Number(m?.commissionPct) || 0,
        firstEpoch: r.firstEpoch,
        lastEpoch: r.lastEpoch,
        snapshotCount: r.snapshotCount,
        totalCommissionMon: r.totalCommissionMon,
        totalCommissionUsd: r.totalCommissionMon * monPriceUsd,
        currentUnclaimedMon: r.currentUnclaimedMon,
        totalClaimedMon: r.totalClaimedMon,
        claimCount: r.claimCount,
      };
    });

    const response = NextResponse.json({
      validators: out,
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
