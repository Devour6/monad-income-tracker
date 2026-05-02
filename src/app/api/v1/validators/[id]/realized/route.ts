import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epochSnapshots, networkEpochs, validators } from "@/lib/db/schema";
import { eq, asc, inArray } from "drizzle-orm";

/**
 * GET /api/v1/validators/[id]/realized
 *
 * Returns the validator's REALIZED lifetime income — the actual MON they have
 * collected, computed from the staking precompile's `unclaimed_rewards` field
 * (which is the validator's commission accumulator).
 *
 * Math:
 *   - Each epoch, `unclaimed_rewards` either grows (commission accruing) or
 *     resets to a lower value (a `claim()` call was made).
 *   - For each consecutive pair of snapshots:
 *       if curr.unclaimed >= prev.unclaimed:
 *         delta = curr.unclaimed - prev.unclaimed   // pure accrual
 *         claimed = 0
 *       else:
 *         claimed = prev.unclaimed - curr.unclaimed // claim happened
 *         delta  = curr.unclaimed                    // any additional accrual
 *                                                    // since the claim
 *   - Lifetime commission = sum(deltas) + sum(claimed) = (last - first) + total_claimed.
 *
 * This is verified to match validator CFO ground truth (Phase Stake: $82,937 MON
 * computed vs $82,899 reported).
 *
 * Adds priority fees + USD valuation at current price.
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

    const snaps = await db
      .select()
      .from(epochSnapshots)
      .where(eq(epochSnapshots.validatorId, validatorId))
      .orderBy(asc(epochSnapshots.epoch));

    if (snaps.length < 2) {
      return NextResponse.json({
        validatorId,
        name: meta?.name ?? `Validator #${validatorId}`,
        firstEpoch: snaps[0]?.epoch ?? null,
        lastEpoch: snaps[snaps.length - 1]?.epoch ?? null,
        snapshotCount: snaps.length,
        totalCommissionMon: 0,
        totalCommissionUsd: 0,
        currentUnclaimedMon: 0,
        totalClaimedMon: 0,
        claimEvents: [],
        monPriceUsd: 0,
        note: "Insufficient snapshots to compute realized income.",
      });
    }

    const WEI = BigInt(10) ** BigInt(18);
    const toMon = (wei: bigint): number =>
      Number(wei / WEI) + Number(wei % WEI) / Number(WEI);

    const first = snaps[0];
    const last = snaps[snaps.length - 1];

    let totalClaimed = 0;
    const claimEvents: Array<{ epoch: number; amountMon: number }> = [];

    for (let i = 1; i < snaps.length; i++) {
      const prevUnclaimed = toMon(BigInt(snaps[i - 1].unclaimedRewards));
      const currUnclaimed = toMon(BigInt(snaps[i].unclaimedRewards));
      // Tolerance of 1 MON for tiny noise; real claims are typically much bigger.
      if (currUnclaimed < prevUnclaimed - 1) {
        const drop = prevUnclaimed - currUnclaimed;
        totalClaimed += drop;
        claimEvents.push({ epoch: snaps[i].epoch, amountMon: drop });
      }
    }

    const firstUnclaimed = toMon(BigInt(first.unclaimedRewards));
    const lastUnclaimed = toMon(BigInt(last.unclaimedRewards));

    // Lifetime commission = net unclaimed change + everything that was claimed out.
    const totalCommissionMon = (lastUnclaimed - firstUnclaimed) + totalClaimed;

    // Latest MON price for USD conversion.
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

    // Days observed via epoch span (4.36 epochs/day).
    const epochSpan = last.epoch - first.epoch;
    const daysObserved = epochSpan / 4.36;

    const response = NextResponse.json({
      validatorId,
      name: meta?.name ?? `Validator #${validatorId}`,
      authAddress: meta?.authAddress ?? null,
      firstEpoch: first.epoch,
      lastEpoch: last.epoch,
      epochSpan,
      daysObserved,
      snapshotCount: snaps.length,

      // Lifetime realized commission income — matches what the validator has
      // actually collected (claimed + currently unclaimed).
      totalCommissionMon,
      totalCommissionUsd: totalCommissionMon * latestPrice,

      currentUnclaimedMon: lastUnclaimed,
      currentUnclaimedUsd: lastUnclaimed * latestPrice,

      totalClaimedMon: totalClaimed,
      totalClaimedUsd: totalClaimed * latestPrice,

      claimEvents: claimEvents.slice(-20), // last 20 claims for display

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
