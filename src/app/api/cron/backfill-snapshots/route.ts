import { NextRequest, NextResponse } from "next/server";
import { runHistoricalSnapshotBackfill } from "@/lib/historical-snapshot-backfill";

/**
 * Scheduled snapshot backfill — runs the historical snapshot reconstruction
 * with a tighter budget and walks backward across runs. Idempotent; safe
 * to fire frequently.
 */

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const floor = parseInt(url.searchParams.get("floor") ?? "1100", 10);
  const budgetMs = parseInt(
    url.searchParams.get("budget_ms") ?? "45000",
    10
  );

  const result = await runHistoricalSnapshotBackfill({
    floorEpoch: Number.isFinite(floor) ? floor : 1100,
    budgetMs: Number.isFinite(budgetMs) ? budgetMs : 45000,
  });
  return NextResponse.json(result);
}
