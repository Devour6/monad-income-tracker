/**
 * GET /api/cron/index-mev
 *
 * Live forward indexer for shMonad SendValidatorRewards events.
 * Resumes from the persisted cursor and walks toward chain head.
 *
 * Triggered every 5 min via GitHub Actions
 * (.github/workflows/index-mev.yml).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 */
import { NextResponse } from "next/server";
import { runMevPayoutIndexer } from "@/lib/mev-payout-indexer";

export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runMevPayoutIndexer({ budgetMs: 50_000 });
  return NextResponse.json(result);
}
