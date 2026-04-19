import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epochSnapshots } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

/**
 * GET /api/admin/debug-snapshots?validator=97
 *
 * Debug endpoint: dumps raw epoch snapshot data for a validator.
 * Shows the raw accRewardPerToken, stakeWei, commission values
 * so we can verify the accumulator is actually changing between epochs.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const validatorId = parseInt(url.searchParams.get("validator") || "97", 10);

  const snapshots = await db
    .select()
    .from(epochSnapshots)
    .where(eq(epochSnapshots.validatorId, validatorId))
    .orderBy(desc(epochSnapshots.epoch))
    .limit(10);

  // Also compute what the delta would be
  const analysis = [];
  for (let i = 0; i < snapshots.length - 1; i++) {
    const newer = snapshots[i];
    const older = snapshots[i + 1];

    const accNew = BigInt(newer.accRewardPerToken);
    const accOld = BigInt(older.accRewardPerToken);
    const stakeWei = BigInt(older.stakeWei);
    const WEI = BigInt(10) ** BigInt(18);

    const delta = accNew - accOld;
    const ZERO = BigInt(0);
    const rewardWei = delta > ZERO ? (delta * stakeWei) / WEI : ZERO;
    const rewardMon = rewardWei > ZERO
      ? Number(rewardWei / WEI) + Number(rewardWei % WEI) / Number(WEI)
      : 0;

    analysis.push({
      fromEpoch: older.epoch,
      toEpoch: newer.epoch,
      accOld: accOld.toString(),
      accNew: accNew.toString(),
      accDelta: delta.toString(),
      deltaIsPositive: delta > BigInt(0),
      rewardMon,
      stakeWei: stakeWei.toString(),
    });
  }

  return NextResponse.json({
    validatorId,
    snapshotCount: snapshots.length,
    snapshots: snapshots.map((s) => ({
      epoch: s.epoch,
      accRewardPerToken: s.accRewardPerToken,
      stakeWei: s.stakeWei,
      commission: s.commission,
      blockRewardsMon: s.blockRewardsMon,
      commissionMon: s.commissionMon,
      createdAt: s.createdAt.toISOString(),
    })),
    analysis,
  });
}
