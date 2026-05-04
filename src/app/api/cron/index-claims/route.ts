import { NextRequest, NextResponse } from "next/server";
import { indexClaimEvents } from "@/lib/claim-event-indexer";

/**
 * GET /api/cron/index-claims
 *
 * Forward indexer for ClaimRewards events from the staking precompile.
 * Resumes from the cursor in claim_indexer_state and walks toward chain
 * head, bounded by RUN_BUDGET_MS.
 *
 * Bearer CRON_SECRET if configured.
 */
function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await indexClaimEvents({ budgetMs: 50_000 });
  return NextResponse.json(result);
}
