import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validators, epochSnapshots } from "@/lib/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { computeApy } from "@/lib/apy";
import { calculateEpochReward } from "@/lib/monad-rpc";

const WEI_PER_MON = BigInt(10) ** BigInt(18);
const HISTORY_EPOCHS = 30;
const MAX_COMPARE = 5;

/**
 * GET /api/compare?ids=1,2,3
 *
 * Compare up to 5 validators side-by-side.
 * Returns for each validator:
 * - validatorId, name, stakeMon, commissionPct
 * - apy (from latest 2 snapshots)
 * - totalIncomeMon (from last 30 epochs)
 * - stakeHistory (last 30 epochs of stakeMon values for charting)
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
    // 1. Fetch validator metadata for all requested IDs
    const validatorRows = await db
      .select()
      .from(validators)
      .where(inArray(validators.validatorId, validatorIds));

    const validatorMap = new Map(
      validatorRows.map((v) => [v.validatorId, v])
    );

    // Check which IDs were not found
    const missingIds = validatorIds.filter((id) => !validatorMap.has(id));
    if (missingIds.length === validatorIds.length) {
      return NextResponse.json(
        { error: "None of the requested validators were found" },
        { status: 404 }
      );
    }

    // 2. Fetch epoch snapshots for all requested validators
    //    We need HISTORY_EPOCHS + 1 per validator to compute deltas
    const allSnapshots = await db
      .select()
      .from(epochSnapshots)
      .where(inArray(epochSnapshots.validatorId, validatorIds))
      .orderBy(desc(epochSnapshots.epoch));

    // Group snapshots by validatorId
    const snapshotsByValidator = new Map<number, typeof allSnapshots>();
    for (const s of allSnapshots) {
      const existing = snapshotsByValidator.get(s.validatorId) || [];
      // Only keep up to HISTORY_EPOCHS + 1 per validator
      if (existing.length <= HISTORY_EPOCHS) {
        existing.push(s);
        snapshotsByValidator.set(s.validatorId, existing);
      }
    }

    // 3. Build comparison data for each validator
    const comparisons = validatorIds
      .filter((id) => validatorMap.has(id))
      .map((id) => {
        const validator = validatorMap.get(id)!;
        const snapshots = snapshotsByValidator.get(id) || [];

        // Compute APY from the latest 2 snapshots
        let apy = 0;
        if (snapshots.length >= 2) {
          const latest = snapshots[0];
          const prev = snapshots[1];
          const epochSpan = latest.epoch - prev.epoch;

          if (epochSpan > 0) {
            const accOld = BigInt(prev.accRewardPerToken);
            const accNew = BigInt(latest.accRewardPerToken);
            const stakeWei = BigInt(prev.stakeWei);

            apy = computeApy(accOld, accNew, stakeWei, epochSpan);
          }
        }

        // Compute total income from consecutive snapshot deltas
        const chronological = [...snapshots].reverse();
        let totalIncomeMon = 0;

        for (let i = 1; i < chronological.length; i++) {
          const prev = chronological[i - 1];
          const curr = chronological[i];

          const accOld = BigInt(prev.accRewardPerToken);
          const accNew = BigInt(curr.accRewardPerToken);
          const stakeWei = BigInt(prev.stakeWei);

          const { totalRewardMon } = calculateEpochReward(
            accOld,
            accNew,
            stakeWei
          );
          totalIncomeMon += totalRewardMon;
        }

        // Build stake history (newest first) for charting
        const stakeHistory = snapshots.map((s) => {
          const sw = BigInt(s.stakeWei);
          const stakeMon =
            Number(sw / WEI_PER_MON) +
            Number(sw % WEI_PER_MON) / Number(WEI_PER_MON);
          return {
            epoch: s.epoch,
            stakeMon,
          };
        });

        return {
          validatorId: validator.validatorId,
          name: validator.name || `Validator #${validator.validatorId}`,
          stakeMon: Number(validator.stakeMon) || 0,
          commissionPct: Number(validator.commissionPct) || 0,
          apy: Number(apy.toFixed(4)),
          totalIncomeMon,
          epochsAnalyzed: chronological.length > 1 ? chronological.length - 1 : 0,
          stakeHistory,
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
