import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validators, epochSnapshots } from "@/lib/db/schema";
import { desc, inArray } from "drizzle-orm";
import { getRealizedIncomeBatch } from "@/lib/realized-income";

const WEI_PER_MON = BigInt(10) ** BigInt(18);
const STAKE_HISTORY_EPOCHS = 30;
const MAX_COMPARE = 5;

/**
 * GET /api/compare?ids=1,2,3
 *
 * Compare up to 5 validators side-by-side using REALIZED commission income
 * (the same math that matches CFO ground truth at <0.1%). Used to use the
 * pool×rate estimate which over/undercounted by 2-5x — that's been replaced
 * with the unclaimed_rewards-delta method.
 *
 * Response shape (kept stable for the compare page):
 *   validators: [{ validatorId, name, stakeMon, commissionPct, apy,
 *                  totalIncomeMon, epochsAnalyzed, stakeHistory }]
 *
 * `apy` here is now realized commission yield on stake = totalCommissionMon /
 * stakeMon, annualized via days-observed. This is the meaningful APY for
 * commission income, not the broken accumulator-based estimate.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");

  if (!idsParam) {
    return NextResponse.json(
      { error: "Missing required query parameter: ids (comma-separated validator IDs)" },
      { status: 400 }
    );
  }

  const validatorIds = idsParam
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);

  if (validatorIds.length === 0) {
    return NextResponse.json(
      { error: "No valid validator IDs provided" },
      { status: 400 }
    );
  }

  if (validatorIds.length > MAX_COMPARE) {
    return NextResponse.json(
      { error: `Maximum ${MAX_COMPARE} validators can be compared at once` },
      { status: 400 }
    );
  }

  try {
    const validatorRows = await db
      .select()
      .from(validators)
      .where(inArray(validators.validatorId, validatorIds));

    const validatorMap = new Map(
      validatorRows.map((v) => [v.validatorId, v])
    );

    const missingIds = validatorIds.filter((id) => !validatorMap.has(id));
    if (missingIds.length === validatorIds.length) {
      return NextResponse.json(
        { error: "None of the requested validators were found" },
        { status: 404 }
      );
    }

    // Realized commission income via shared lib — same math as CFO.
    const realized = await getRealizedIncomeBatch(validatorIds);

    // Stake history for the chart: last 30 epochs per validator.
    const stakeRows = await db
      .select({
        validatorId: epochSnapshots.validatorId,
        epoch: epochSnapshots.epoch,
        stakeWei: epochSnapshots.stakeWei,
      })
      .from(epochSnapshots)
      .where(inArray(epochSnapshots.validatorId, validatorIds))
      .orderBy(desc(epochSnapshots.epoch));

    const stakeByValidator = new Map<
      number,
      Array<{ epoch: number; stakeMon: number }>
    >();
    for (const r of stakeRows) {
      const arr = stakeByValidator.get(r.validatorId) ?? [];
      if (arr.length >= STAKE_HISTORY_EPOCHS) continue;
      const sw = BigInt(r.stakeWei);
      const stakeMon =
        Number(sw / WEI_PER_MON) + Number(sw % WEI_PER_MON) / Number(WEI_PER_MON);
      arr.push({ epoch: r.epoch, stakeMon });
      stakeByValidator.set(r.validatorId, arr);
    }

    const comparisons = validatorIds
      .filter((id) => validatorMap.has(id))
      .map((id) => {
        const v = validatorMap.get(id)!;
        const r = realized.get(id);
        const totalCommissionMon = r?.totalCommissionMon ?? 0;
        const firstEpoch = r?.firstEpoch ?? null;
        const lastEpoch = r?.lastEpoch ?? null;
        const epochsAnalyzed =
          firstEpoch != null && lastEpoch != null
            ? lastEpoch - firstEpoch
            : 0;
        const daysObserved = epochsAnalyzed / 4.36;
        const stakeMon = Number(v.stakeMon) || 0;

        // Realized commission APY = annualized commission yield on stake.
        // (commission / stake) / days * 365 * 100
        const apy =
          stakeMon > 0 && daysObserved > 0
            ? (totalCommissionMon / stakeMon / daysObserved) * 365 * 100
            : 0;

        return {
          validatorId: v.validatorId,
          name: v.name || `Validator #${v.validatorId}`,
          stakeMon,
          commissionPct: Number(v.commissionPct) || 0,
          apy: Number(apy.toFixed(4)),
          totalIncomeMon: totalCommissionMon,
          totalCommissionMon,
          totalClaimedMon: r?.totalClaimedMon ?? 0,
          currentUnclaimedMon: r?.currentUnclaimedMon ?? 0,
          claimCount: r?.claimCount ?? 0,
          epochsAnalyzed,
          daysObserved: Number(daysObserved.toFixed(2)),
          stakeHistory: stakeByValidator.get(id) ?? [],
        };
      });

    const response = NextResponse.json({
      validators: comparisons,
      count: comparisons.length,
      missingIds: missingIds.length > 0 ? missingIds : undefined,
    });

    response.headers.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=600"
    );
    return response;
  } catch (error) {
    console.error(
      "[compare] Error:",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
