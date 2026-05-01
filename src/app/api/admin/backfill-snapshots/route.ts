import { NextRequest, NextResponse } from "next/server";
import {
  runHistoricalSnapshotBackfill,
  getSnapshotCoverage,
} from "@/lib/historical-snapshot-backfill";

/**
 * POST /api/admin/backfill-snapshots
 *
 * Walks backward from the earliest existing snapshot epoch, reconstructing
 * epoch_snapshots rows by querying the staking precompile at historical
 * block tags. Idempotent.
 *
 * Query params:
 *   floor=1100        — earliest epoch to backfill down to
 *   budget_ms=50000   — wall-clock budget per run (Vercel-safe default)
 *   max_per_epoch=N   — limit validators per epoch (debug only)
 *
 * Auth: Bearer CRON_SECRET (same scheme as other admin routes).
 *
 * GET (no body): returns coverage report only.
 */

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  return Boolean(process.env.CRON_SECRET) && auth === expected;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const from = parseInt(url.searchParams.get("from") ?? "1100", 10);
  const to = parseInt(url.searchParams.get("to") ?? "1500", 10);
  const coverage = await getSnapshotCoverage(from, to);
  return NextResponse.json({ from, to, coverage });
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const floor = parseInt(url.searchParams.get("floor") ?? "1100", 10);
  const budgetMs = parseInt(
    url.searchParams.get("budget_ms") ?? "50000",
    10
  );
  const maxPerEpochParam = url.searchParams.get("max_per_epoch");
  const maxPerEpoch = maxPerEpochParam
    ? parseInt(maxPerEpochParam, 10)
    : undefined;

  const result = await runHistoricalSnapshotBackfill({
    floorEpoch: Number.isFinite(floor) ? floor : 1100,
    budgetMs: Number.isFinite(budgetMs) ? budgetMs : 50000,
    maxPerEpoch:
      maxPerEpoch && Number.isFinite(maxPerEpoch) ? maxPerEpoch : undefined,
  });

  return NextResponse.json(result);
}
