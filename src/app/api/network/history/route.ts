import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { networkEpochs } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

/**
 * GET /api/network/history?limit=90
 *
 * Returns epoch-by-epoch network data from the networkEpochs table.
 * Sorted newest first.
 *
 * Query params:
 *   - limit: Number of epochs to return (default 90, max 365)
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawLimit = parseInt(url.searchParams.get("limit") || "90", 10);
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 90 : rawLimit, 1), 365);

    const rows = await db
      .select()
      .from(networkEpochs)
      .orderBy(desc(networkEpochs.epoch))
      .limit(limit);

    const history = rows.map((row) => ({
      epoch: row.epoch,
      totalStakeMon: Number(row.totalStakeMon) || 0,
      activeValidators: row.activeValidators ?? 0,
      monPriceUsd: Number(row.monPriceUsd) || 0,
      createdAt: row.createdAt.toISOString(),
    }));

    const response = NextResponse.json({
      history,
      count: history.length,
      limit,
    });

    response.headers.set(
      "Cache-Control",
      "public, s-maxage=600, stale-while-revalidate=1200"
    );
    return response;
  } catch (error) {
    console.error(
      "[network/history] Error:",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
