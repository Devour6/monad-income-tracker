import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epochSnapshots, validators as validatorsTable } from "@/lib/db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { getSelfStakes } from "@/lib/monad-rpc";

/**
 * One-off backfill: populate self_stake_wei for recent epoch snapshots that
 * were taken before self-stake tracking landed. Hits the staking precompile
 * for self-stake per validator (current value) and writes it to the most
 * recent snapshot rows so income attribution lights up immediately instead
 * of waiting ~2 cron cycles.
 *
 * Auth: requires CRON_SECRET as Bearer token.
 * Query param: ?epoch=<n> to target a specific epoch (default: latest).
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
  const targetEpochRaw = url.searchParams.get("epoch");
  const targetEpoch = targetEpochRaw ? parseInt(targetEpochRaw, 10) : null;

  try {
    // Figure out which epoch to backfill
    let epoch = targetEpoch;
    if (epoch == null) {
      const [latest] = await db
        .select({ epoch: epochSnapshots.epoch })
        .from(epochSnapshots)
        .orderBy(sql`${epochSnapshots.epoch} DESC`)
        .limit(1);
      if (!latest) {
        return NextResponse.json(
          { error: "No snapshots exist yet" },
          { status: 404 }
        );
      }
      epoch = latest.epoch;
    }

    // Pull snapshots missing self-stake for that epoch and join auth
    // addresses from the validators table
    const rows = await db
      .select({
        validatorId: epochSnapshots.validatorId,
        authAddress: validatorsTable.authAddress,
      })
      .from(epochSnapshots)
      .innerJoin(
        validatorsTable,
        eq(epochSnapshots.validatorId, validatorsTable.validatorId)
      )
      .where(
        and(eq(epochSnapshots.epoch, epoch), isNull(epochSnapshots.selfStakeWei))
      );

    if (rows.length === 0) {
      return NextResponse.json({
        status: "nothing_to_backfill",
        epoch,
      });
    }

    const selfStakes = await getSelfStakes(
      rows.map((r) => ({
        validatorId: r.validatorId,
        authAddress: r.authAddress,
      }))
    );

    let updated = 0;
    for (const [validatorId, stakeWei] of selfStakes) {
      await db
        .update(epochSnapshots)
        .set({ selfStakeWei: stakeWei.toString() })
        .where(
          and(
            eq(epochSnapshots.epoch, epoch),
            eq(epochSnapshots.validatorId, validatorId)
          )
        );
      updated++;
    }

    return NextResponse.json({
      status: "success",
      epoch,
      candidates: rows.length,
      fetched: selfStakes.size,
      updated,
    });
  } catch (err) {
    console.error("[backfill-self-stake]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
