import { NextRequest, NextResponse } from "next/server";
import { indexClaimEvents } from "@/lib/claim-event-indexer";

/**
 * POST /api/admin/index-claims
 *
 * Force-run the claim event indexer over a specific range or just from
 * the cursor forward. Auth: bearer CRON_SECRET.
 *
 * Body / query:
 *   fromBlock=N    optional override (default: cursor + 1)
 *   toBlock=N      optional override (default: chain head)
 *   maxBlocks=N    cap blocks per run (default: unlimited until budget)
 *   budgetMs=N     wall-clock cap (default 50000)
 */
function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const fromBlock = url.searchParams.get("fromBlock");
  const toBlock = url.searchParams.get("toBlock");
  const maxBlocks = url.searchParams.get("maxBlocks");
  const budgetMs = url.searchParams.get("budgetMs");

  const result = await indexClaimEvents({
    fromBlock: fromBlock ? BigInt(fromBlock) : undefined,
    toBlock: toBlock ? BigInt(toBlock) : undefined,
    maxBlocks: maxBlocks ? Number(maxBlocks) : undefined,
    budgetMs: budgetMs ? Number(budgetMs) : undefined,
  });

  return NextResponse.json(result);
}

export async function GET(req: NextRequest) {
  return POST(req);
}
