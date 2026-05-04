import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { networkEpochs, validators, epochSnapshots } from "@/lib/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import { getRealizedIncome } from "@/lib/realized-income";

/**
 * GET /api/v1/validators/[id]/realized
 *
 * Returns the validator's lifetime realized commission, computed from
 * accumulator deltas × commission rate (the correct formula). See
 * src/lib/realized-income.ts for math.
 *
 * Also returns claim events (drops in unclaimed_rewards) for transparency,
 * though note: those drops represent the FULL pool's distribution events,
 * not the validator's commission take alone.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const validatorId = parseInt(id, 10);
  if (!Number.isFinite(validatorId)) {
    return NextResponse.json({ error: "Invalid validator ID" }, { status: 400 });
  }

  try {
    const [meta] = await db
      .select()
      .from(validators)
      .where(eq(validators.validatorId, validatorId))
      .limit(1);

    const realized = await getRealizedIncome(validatorId);

    if (realized.snapshotCount < 2) {
      return NextResponse.json({
        validatorId,
        name: meta?.name ?? `Validator #${validatorId}`,
        firstEpoch: realized.firstEpoch,
        lastEpoch: realized.lastEpoch,
        snapshotCount: realized.snapshotCount,
        totalCommissionMon: 0,
        totalCommissionUsd: 0,
        currentUnclaimedMon: 0,
        totalClaimedMon: 0,
        totalPoolMon: 0,
        claimEvents: [],
        monPriceUsd: 0,
        note: "Insufficient snapshots to compute realized income.",
      });
    }

    // Pull snapshots once more for claim event timeline. Cheap enough; this
    // endpoint is cached. We could expose this from the lib but the lib's
    // contract is intentionally minimal.
    const snaps = await db
      .select({
        epoch: epochSnapshots.epoch,
        unclaimedRewards: epochSnapshots.unclaimedRewards,
      })
      .from(epochSnapshots)
      .where(eq(epochSnapshots.validatorId, validatorId))
      .orderBy(asc(epochSnapshots.epoch));

    const WEI = BigInt(10) ** BigInt(18);
    const toMon = (wei: bigint) =>
      Number(wei / WEI) + Number(wei % WEI) / Number(WEI);

    const claimEvents: Array<{ epoch: number; amountMon: number }> = [];
    for (let i = 1; i < snaps.length; i++) {
      const prev = BigInt(snaps[i - 1].unclaimedRewards);
      const curr = BigInt(snaps[i].unclaimedRewards);
      if (curr < prev - BigInt(1)) {
        claimEvents.push({
          epoch: snaps[i].epoch,
          amountMon: toMon(prev - curr),
        });
      }
    }

    // Latest known MON price for USD valuation.
    const epochIds = snaps.map((s) => s.epoch);
    const networkRows = await db
      .select()
      .from(networkEpochs)
      .where(inArray(networkEpochs.epoch, epochIds));
    let latestPrice = 0;
    let latestPriceEpoch = 0;
    for (const r of networkRows) {
      const p = Number(r.monPriceUsd) || 0;
      if (p > 0 && r.epoch > latestPriceEpoch) {
        latestPrice = p;
        latestPriceEpoch = r.epoch;
      }
    }

    const epochSpan = (realized.lastEpoch ?? 0) - (realized.firstEpoch ?? 0);
    const daysObserved = epochSpan / 4.36;

    const response = NextResponse.json({
      validatorId,
      name: meta?.name ?? `Validator #${validatorId}`,
      authAddress: meta?.authAddress ?? null,
      firstEpoch: realized.firstEpoch,
      lastEpoch: realized.lastEpoch,
      epochSpan,
      daysObserved,
      snapshotCount: realized.snapshotCount,

      // Lifetime commission (validator's actual income from commissioning).
      totalCommissionMon: realized.totalCommissionMon,
      totalCommissionUsd: realized.totalCommissionMon * latestPrice,

      // Total reward pool that flowed through this validator (commission + delegator).
      totalPoolMon: realized.totalPoolMon,

      // Currently unclaimed_rewards on-chain. NOTE: this represents the
      // full pool's pending distribution, not commission alone.
      currentUnclaimedMon: realized.currentUnclaimedMon,
      currentUnclaimedUsd: realized.currentUnclaimedMon * latestPrice,

      // Sum of detected drops in unclaimed_rewards (pool distributions, not
      // commission claims).
      totalClaimedMon: realized.totalClaimedMon,
      totalClaimedUsd: realized.totalClaimedMon * latestPrice,

      claimEvents: claimEvents.slice(-20),

      monPriceUsd: latestPrice,
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
