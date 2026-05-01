import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epochPriorityFees, epochSnapshots, indexerState } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

/**
 * GET /api/v1/backfill/status
 *
 * Reports indexer + snapshot coverage so external monitors (and the
 * auto-backfill cron driver) can decide whether to keep walking backwards.
 *
 * Returns:
 *   - indexer: { lastBlock, lastEpoch }
 *   - blocks:  { earliestBlock, latestBlock, totalRows }
 *   - epochs:  { earliestEpoch, latestEpoch, distinctEpochs }
 *   - snapshots: { earliestEpoch, latestEpoch, totalRows }
 *
 * Stable contract under `v1`.
 */
export async function GET() {
  try {
    const [cursor] = await db.select().from(indexerState).limit(1);

    const blockRange = (await db
      .select({
        earliest: sql<string | null>`MIN(${epochPriorityFees.firstBlock})`,
        latest: sql<string | null>`MAX(${epochPriorityFees.lastBlock})`,
        rows: sql<number>`COUNT(*)::INT`,
        earliestEpoch: sql<number | null>`MIN(${epochPriorityFees.epoch})`,
        latestEpoch: sql<number | null>`MAX(${epochPriorityFees.epoch})`,
        distinctEpochs: sql<number>`COUNT(DISTINCT ${epochPriorityFees.epoch})::INT`,
      })
      .from(epochPriorityFees)) as unknown as {
      earliest: string | null;
      latest: string | null;
      rows: number;
      earliestEpoch: number | null;
      latestEpoch: number | null;
      distinctEpochs: number;
    }[];

    const snapRange = (await db
      .select({
        earliestEpoch: sql<number | null>`MIN(${epochSnapshots.epoch})`,
        latestEpoch: sql<number | null>`MAX(${epochSnapshots.epoch})`,
        rows: sql<number>`COUNT(*)::INT`,
      })
      .from(epochSnapshots)) as unknown as {
      earliestEpoch: number | null;
      latestEpoch: number | null;
      rows: number;
    }[];

    const br = blockRange[0];
    const sr = snapRange[0];

    const response = NextResponse.json({
      indexer: cursor
        ? {
            lastBlock: cursor.lastBlock?.toString() ?? null,
            lastEpoch: cursor.lastEpoch ?? null,
          }
        : null,
      blocks: {
        earliestBlock: br?.earliest ?? null,
        latestBlock: br?.latest ?? null,
        totalRows: Number(br?.rows ?? 0),
        earliestEpoch: br?.earliestEpoch ?? null,
        latestEpoch: br?.latestEpoch ?? null,
        distinctEpochs: Number(br?.distinctEpochs ?? 0),
      },
      snapshots: {
        earliestEpoch: sr?.earliestEpoch ?? null,
        latestEpoch: sr?.latestEpoch ?? null,
        totalRows: Number(sr?.rows ?? 0),
      },
      generatedAt: new Date().toISOString(),
    });

    response.headers.set(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=120"
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
