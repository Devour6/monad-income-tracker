import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epochPriorityFees } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { runIndexer } from "@/lib/block-indexer";

/**
 * GET /api/cron/auto-backfill
 *
 * Walks the priority-fee indexer **backwards** in time. Each invocation:
 *   1. Reads the earliest block currently indexed.
 *   2. Computes a backwards window: [earliest - chunk, earliest - 1].
 *   3. Runs runIndexer({ range }) over that window — touches its own row
 *      keyspace; does not move the live forward cursor.
 *   4. Returns progress so a GH Actions cron can self-throttle.
 *
 * Query params:
 *   chunk=N    — blocks per run (default 5000, max 50_000)
 *   floor=N    — refuse to walk below this block (default 1)
 *
 * Auth: bearer CRON_SECRET if set; otherwise open like the other crons.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_CHUNK = 5000;
const MAX_CHUNK = 50_000;
const DEFAULT_FLOOR = BigInt(1);

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(request.url);
  const chunkParam = parseInt(url.searchParams.get("chunk") || "", 10);
  const chunk = Number.isFinite(chunkParam) && chunkParam > 0
    ? Math.min(chunkParam, MAX_CHUNK)
    : DEFAULT_CHUNK;
  const floorParam = url.searchParams.get("floor");
  const floor = floorParam && /^\d+$/.test(floorParam)
    ? BigInt(floorParam)
    : DEFAULT_FLOOR;

  try {
    // Find the earliest block we have indexed across any miner row.
    const [{ earliest }] = (await db
      .select({
        earliest: sql<string | null>`MIN(${epochPriorityFees.firstBlock})`,
      })
      .from(epochPriorityFees)) as unknown as { earliest: string | null }[];

    if (!earliest) {
      return NextResponse.json({
        status: "no-data",
        message:
          "No indexed blocks yet — let the forward indexer run first to establish a starting point.",
      });
    }

    const earliestIndexed = BigInt(earliest);
    if (earliestIndexed <= floor) {
      return NextResponse.json({
        status: "complete",
        floor: floor.toString(),
        earliestIndexed: earliestIndexed.toString(),
        message: "Backfill has reached the configured floor.",
      });
    }

    const to = earliestIndexed - BigInt(1);
    const fromCandidate = to - BigInt(chunk - 1);
    const from = fromCandidate < floor ? floor : fromCandidate;

    const result = await runIndexer({ range: { from, to } });

    return NextResponse.json({
      status: "ok",
      window: {
        from: from.toString(),
        to: to.toString(),
        size: Number(to - from + BigInt(1)),
      },
      result: {
        blocksProcessed: result.blocksProcessed,
        blocksAttributed: result.blocksAttributed,
        totalPriorityFeesWei: result.totalPriorityFeesWei,
        epochsTouched: result.epochsTouched.length,
        minersTouched: result.minersTouched,
        minersResolved: result.minersResolved,
        durationMs: result.durationMs,
      },
      next: {
        earliestAfter: from.toString(),
        hint:
          from > floor
            ? `/api/cron/auto-backfill?chunk=${chunk}&floor=${floor.toString()}`
            : null,
        complete: from <= floor,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
