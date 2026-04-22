import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epochSnapshots, validators } from "@/lib/db/schema";
import { eq, isNull, and } from "drizzle-orm";
import { getAuthBalances } from "@/lib/monad-rpc";

/**
 * POST /api/admin/backfill-auth-balance?epoch=<n>
 *
 * Fetches current authAddress native balance for every validator that has
 * a snapshot at `epoch` and fills in the `auth_balance_wei` column.
 *
 * CAVEAT: this writes *current* balance to a historical snapshot. For recent
 * epochs (within a day or two) it's a reasonable approximation; for very old
 * epochs it's just a placeholder so the income-API doesn't have gaps. Real
 * per-epoch accuracy only starts with the cron capturing live balances going
 * forward.
 *
 * Auth: requires Bearer CRON_SECRET.
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
  const epochParam = url.searchParams.get("epoch");
  if (!epochParam) {
    return NextResponse.json(
      { error: "Missing required query parameter: epoch" },
      { status: 400 }
    );
  }
  const epoch = parseInt(epochParam, 10);
  if (isNaN(epoch)) {
    return NextResponse.json(
      { error: "Invalid epoch parameter" },
      { status: 400 }
    );
  }

  try {
    // Find snapshots at this epoch missing authBalanceWei
    const candidates = await db
      .select({
        validatorId: epochSnapshots.validatorId,
        authAddress: validators.authAddress,
      })
      .from(epochSnapshots)
      .innerJoin(
        validators,
        eq(epochSnapshots.validatorId, validators.validatorId)
      )
      .where(
        and(
          eq(epochSnapshots.epoch, epoch),
          isNull(epochSnapshots.authBalanceWei)
        )
      );

    if (candidates.length === 0) {
      return NextResponse.json({
        status: "success",
        epoch,
        candidates: 0,
        fetched: 0,
        updated: 0,
      });
    }

    const addresses = [...new Set(candidates.map((c) => c.authAddress))];
    const balanceMap = await getAuthBalances(addresses);

    let updated = 0;
    for (const c of candidates) {
      const bal =
        balanceMap.get(c.authAddress.toLowerCase()) ??
        balanceMap.get(c.authAddress);
      if (bal == null) continue;
      await db
        .update(epochSnapshots)
        .set({ authBalanceWei: bal.toString() })
        .where(
          and(
            eq(epochSnapshots.epoch, epoch),
            eq(epochSnapshots.validatorId, c.validatorId)
          )
        );
      updated += 1;
    }

    return NextResponse.json({
      status: "success",
      epoch,
      candidates: candidates.length,
      fetched: balanceMap.size,
      updated,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
