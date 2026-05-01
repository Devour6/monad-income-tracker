import { NextResponse } from "next/server";
import { runIndexer } from "@/lib/block-indexer";

/**
 * Admin: backfill the priority-fee block indexer over a custom range.
 *
 * GET /api/admin/backfill-blocks?from=<bigint>&to=<bigint>&maxBlocks=<int>
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * The default `runIndexer()` in cron walks forward from `cursor.lastBlock + 1`.
 * This endpoint forces a specific [from, to] window without disturbing the
 * cursor — useful for filling gaps after schema migrations or extending
 * history further back than the cron started.
 *
 * Time-budgeted: the indexer's internal RUN_BUDGET_MS will cap the work per
 * call. Re-invoke with the next from = previous_endBlock + 1 to chunk through.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authed(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // open if no secret set (matches /api/cron behaviour)
  const auth = request.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authed(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const maxBlocksStr = url.searchParams.get("maxBlocks");

  if (!fromStr || !toStr) {
    return NextResponse.json(
      { error: "Required params: from, to (block numbers)" },
      { status: 400 }
    );
  }

  let from: bigint;
  let to: bigint;
  try {
    from = BigInt(fromStr);
    to = BigInt(toStr);
  } catch {
    return NextResponse.json(
      { error: "from/to must be integer block numbers" },
      { status: 400 }
    );
  }
  if (from < BigInt(0) || to < from) {
    return NextResponse.json(
      { error: "Invalid range" },
      { status: 400 }
    );
  }

  const maxBlocks = maxBlocksStr
    ? Math.max(1, Math.min(50_000, parseInt(maxBlocksStr, 10) || 0))
    : undefined;

  try {
    const result = await runIndexer({
      range: { from, to },
      maxBlocks,
    });
    return NextResponse.json({
      ok: true,
      result: {
        startBlock: result.startBlock.toString(),
        endBlock: result.endBlock.toString(),
        blocksProcessed: result.blocksProcessed,
        blocksAttributed: result.blocksAttributed,
        totalPriorityFeesWei: result.totalPriorityFeesWei,
        epochsTouched: result.epochsTouched,
        minersTouched: result.minersTouched,
        minersResolved: result.minersResolved,
        durationMs: result.durationMs,
      },
      hint:
        result.endBlock < to
          ? `Continue with from=${(result.endBlock + BigInt(1)).toString()}&to=${to.toString()}`
          : "Range complete",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
