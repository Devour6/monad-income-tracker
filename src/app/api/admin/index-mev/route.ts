/**
 * POST /api/admin/index-mev
 *
 * Manually trigger the MEV payout indexer (shMonad SendValidatorRewards).
 * Used for backfilling historical ranges. Live forward indexing runs via
 * the cron at /api/cron/index-mev.
 *
 * Query params:
 *   fromBlock=N    optional override (default: cursor + 1)
 *   toBlock=N      optional override (default: chain head)
 *   maxBlocks=N    cap blocks per run
 *   budgetMs=N     wall-clock cap (default 50000)
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 */
import { NextResponse } from "next/server";
import { runMevPayoutIndexer } from "@/lib/mev-payout-indexer";

export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const fromBlock = url.searchParams.get("fromBlock");
  const toBlock = url.searchParams.get("toBlock");
  const maxBlocks = url.searchParams.get("maxBlocks");
  const budgetMs = url.searchParams.get("budgetMs");

  const result = await runMevPayoutIndexer({
    fromBlock: fromBlock ? BigInt(fromBlock) : undefined,
    toBlock: toBlock ? BigInt(toBlock) : undefined,
    maxBlocks: maxBlocks ? Number(maxBlocks) : undefined,
    budgetMs: budgetMs ? Number(budgetMs) : undefined,
  });

  return NextResponse.json(result);
}
