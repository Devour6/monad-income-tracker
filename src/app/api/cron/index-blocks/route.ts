import { NextResponse } from "next/server";
import { runIndexer } from "@/lib/block-indexer";

/**
 * Continuous block-level indexer entrypoint.
 *
 * Resumes from the persisted cursor (or bootstraps from `head - 50000`
 * the first time) and walks forward attributing priority fees to validators
 * until the run budget is hit.
 *
 * Designed to be called by an EXTERNAL scheduler (cron-job.org, GitHub
 * Actions, etc.) every ~1-5 minutes — Vercel Hobby's once-a-day cron
 * limit makes the built-in scheduler insufficient. Each call is bounded
 * to ~50s wall clock so it always finishes well inside the function timeout.
 *
 * Optional query params:
 *   - max_blocks: cap on blocks to process this run (debug)
 *   - seed: starting block when no cursor exists (debug)
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const maxBlocksParam = url.searchParams.get("max_blocks");
  const seedParam = url.searchParams.get("seed");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const maxBlocks = maxBlocksParam ? parseInt(maxBlocksParam, 10) : undefined;
  const seedBlock = seedParam ? BigInt(seedParam) : undefined;
  const range =
    fromParam && toParam
      ? { from: BigInt(fromParam), to: BigInt(toParam) }
      : undefined;

  try {
    const result = await runIndexer({
      maxBlocks: maxBlocks && maxBlocks > 0 ? maxBlocks : undefined,
      seedBlock,
      range,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      // bigint→string for JSON
      startBlock: result.startBlock.toString(),
      endBlock: result.endBlock.toString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
