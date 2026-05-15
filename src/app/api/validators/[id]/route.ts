import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validators, epochSnapshots } from "@/lib/db/schema";
import { claimEvents } from "@/lib/db/claim-events-schema";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { computeApy, EPOCHS_PER_DAY } from "@/lib/apy";

const WEI_PER_MON = BigInt(10) ** BigInt(18);

/**
 * GET /api/validators/[id]?epochs=30
 *
 * Returns detailed info for a single validator.
 *
 * Income fields are sourced from real on-chain data ONLY:
 *   - commissionMon = sum of ClaimRewards events to the auth address +
 *                     (current auth_unclaimed - earliest-in-window auth_unclaimed)
 *   - APY = measured pool yield from accRewardPerToken accumulator delta
 *     (this is the actual delegator-pool yield, not a projection)
 *
 * We deliberately do NOT compute `commissionMon = poolMon × commission_rate`.
 * That formula overcounts by 2-5x because the on-chain protocol distribution
 * isn't a simple rate × pool — verified empirically against CFO records and
 * the staking precompile's `getDelegator(valId, authAddr).slot2` reading.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const validatorId = parseInt(id, 10);

  if (isNaN(validatorId) || validatorId < 1) {
    return NextResponse.json({ error: "Invalid validator ID" }, { status: 400 });
  }

  const url = new URL(request.url);
  const rawEpochs = parseInt(url.searchParams.get("epochs") || "30", 10);
  const epochCount = Math.min(
    Math.max(isNaN(rawEpochs) ? 30 : rawEpochs, 1),
    365
  );

  try {
    const [validator] = await db
      .select()
      .from(validators)
      .where(eq(validators.validatorId, validatorId))
      .limit(1);

    if (!validator) {
      return NextResponse.json(
        { error: `Validator ${validatorId} not found` },
        { status: 404 }
      );
    }

    const snapshots = await db
      .select()
      .from(epochSnapshots)
      .where(eq(epochSnapshots.validatorId, validatorId))
      .orderBy(desc(epochSnapshots.epoch))
      .limit(epochCount + 1);

    // APY from the latest 2 snapshots (delegator-pool yield, measured on-chain
    // via accRewardPerToken accumulator delta — not a model).
    let apy = 0;
    if (snapshots.length >= 2) {
      const latest = snapshots[0];
      const prev = snapshots[1];
      const epochSpan = latest.epoch - prev.epoch;
      if (epochSpan > 0) {
        apy = computeApy(
          BigInt(prev.accRewardPerToken),
          BigInt(latest.accRewardPerToken),
          BigInt(prev.stakeWei),
          epochSpan
        );
      }
    }

    const stakeHistory = snapshots.map((s) => {
      const sw = BigInt(s.stakeWei);
      const stakeMon =
        Number(sw / WEI_PER_MON) +
        Number(sw % WEI_PER_MON) / Number(WEI_PER_MON);
      return { epoch: s.epoch, stakeMon, stakeWei: s.stakeWei };
    });

    const commissionHistory = snapshots.map((s) => ({
      epoch: s.epoch,
      commissionPct: Number(BigInt(s.commission)) / 1e16,
      commissionRaw: s.commission,
    }));

    // Realized commission income — on-chain truth only.
    //
    // 1) Sum every ClaimRewards event to the auth address in the window.
    // 2) Plus the current auth_unclaimed slot from the most recent snapshot
    //    minus the earliest-in-window auth_unclaimed (the accrued-but-not-
    //    yet-withdrawn delta over the observed range).
    const oldestEpoch =
      snapshots.length > 0
        ? snapshots[snapshots.length - 1].epoch
        : 0;
    const auth = validator.authAddress.toLowerCase();

    const claimRows = await db
      .select({
        amountWei: claimEvents.amountWei,
      })
      .from(claimEvents)
      .where(
        and(
          eq(claimEvents.validatorId, validatorId),
          eq(claimEvents.delegator, auth),
          gte(claimEvents.epoch, oldestEpoch)
        )
      );
    let claimedWei = BigInt(0);
    for (const r of claimRows) claimedWei += BigInt(r.amountWei);
    const claimedMon =
      Number(claimedWei / WEI_PER_MON) +
      Number(claimedWei % WEI_PER_MON) / Number(WEI_PER_MON);

    // Auth-unclaimed delta over the observed window.
    // Read via raw SQL since the typed schema doesn't know about the column.
    const authUncRows = (await db.execute(sql`
      SELECT epoch, auth_unclaimed_wei
      FROM epoch_snapshots
      WHERE validator_id = ${validatorId}
        AND auth_unclaimed_wei IS NOT NULL
        AND epoch >= ${oldestEpoch}
      ORDER BY epoch DESC
    `)) as unknown as {
      rows?: Array<{ epoch: number; auth_unclaimed_wei: string }>;
    };
    const authUncList = Array.isArray(authUncRows.rows)
      ? authUncRows.rows
      : (authUncRows as unknown as Array<{
          epoch: number;
          auth_unclaimed_wei: string;
        }>);

    let authUncDeltaMon = 0;
    if (authUncList.length >= 2) {
      const latest = BigInt(authUncList[0].auth_unclaimed_wei || "0");
      const earliest = BigInt(
        authUncList[authUncList.length - 1].auth_unclaimed_wei || "0"
      );
      const delta = latest > earliest ? latest - earliest : BigInt(0);
      authUncDeltaMon =
        Number(delta / WEI_PER_MON) +
        Number(delta % WEI_PER_MON) / Number(WEI_PER_MON);
    } else if (authUncList.length === 1) {
      // Only one auth_unclaimed sample: count current pending as accrual
      // (better undercount-correctly than guess).
      const latest = BigInt(authUncList[0].auth_unclaimed_wei || "0");
      authUncDeltaMon =
        Number(latest / WEI_PER_MON) +
        Number(latest % WEI_PER_MON) / Number(WEI_PER_MON);
    }

    const totalCommission = claimedMon + authUncDeltaMon;
    const totalEpochSpan =
      snapshots.length > 1
        ? snapshots[0].epoch - snapshots[snapshots.length - 1].epoch
        : 0;
    const avgCommissionPerEpoch =
      totalEpochSpan > 0 ? totalCommission / totalEpochSpan : 0;

    const response = NextResponse.json({
      validator: {
        validatorId: validator.validatorId,
        name: validator.name || `Validator #${validator.validatorId}`,
        authAddress: validator.authAddress,
        stakeMon: Number(validator.stakeMon) || 0,
        commissionPct: Number(validator.commissionPct) || 0,
        lastEpoch: validator.lastEpoch,
        updatedAt: validator.updatedAt.toISOString(),
      },
      apy: Number(apy.toFixed(4)),
      income: {
        observed: {
          epochCount: totalEpochSpan,
          snapshotCount: snapshots.length,
          daysObserved: totalEpochSpan / EPOCHS_PER_DAY,
          // Commission income — claims + auth-unclaimed delta. On-chain only.
          commissionMon: totalCommission,
          claimedMon,
          pendingDeltaMon: authUncDeltaMon,
        },
        rates: {
          commissionPerEpochMon: avgCommissionPerEpoch,
          commissionPerDayMon: avgCommissionPerEpoch * EPOCHS_PER_DAY,
          commissionPerMonthMon: avgCommissionPerEpoch * EPOCHS_PER_DAY * 30,
          commissionPerYearMon: avgCommissionPerEpoch * EPOCHS_PER_DAY * 365,
        },
      },
      stakeHistory,
      commissionHistory,
      latestEpoch: snapshots.length > 0 ? snapshots[0].epoch : null,
    });

    response.headers.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=600"
    );
    return response;
  } catch (error) {
    console.error(
      `[validators/${validatorId}] Error:`,
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
