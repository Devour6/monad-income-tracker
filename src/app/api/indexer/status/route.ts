import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { indexerState, epochPriorityFees, minerAliases } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

/**
 * GET /api/indexer/status
 *
 * Public health endpoint for the block-level priority-fee indexer.
 * Surfaces the current cursor, lag relative to chain head, miner-alias
 * coverage, and total fees indexed so far. Read-only — no secrets needed.
 */
export const dynamic = "force-dynamic";

async function getChainHead(): Promise<bigint | null> {
  try {
    const res = await fetch(
      process.env.MONAD_RPC_URL || "https://rpc.monad.xyz",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_blockNumber",
          params: [],
        }),
      }
    );
    const data = await res.json();
    if (typeof data.result !== "string") return null;
    return BigInt(data.result);
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const cursorRows = await db
      .select()
      .from(indexerState)
      .limit(1);
    const cursor = cursorRows[0];

    const head = await getChainHead();

    const totalsRow = (await db.execute(sql`
      SELECT
        COUNT(*)::int                                                 AS rows,
        COUNT(DISTINCT miner_address)::int                            AS unique_miners,
        COUNT(DISTINCT epoch)::int                                    AS epochs_covered,
        COALESCE(SUM(blocks_proposed), 0)::int                        AS blocks_indexed,
        COALESCE(SUM(CAST(priority_fees_wei AS NUMERIC)), 0)::TEXT    AS total_fees_wei,
        MIN(first_block)::TEXT                                        AS earliest_block,
        MAX(last_block)::TEXT                                         AS latest_block
      FROM epoch_priority_fees
    `)) as unknown as
      | {
          rows: Array<{
            rows: number;
            unique_miners: number;
            epochs_covered: number;
            blocks_indexed: number;
            total_fees_wei: string;
            earliest_block: string | null;
            latest_block: string | null;
          }>;
        }
      | Array<{
          rows: number;
          unique_miners: number;
          epochs_covered: number;
          blocks_indexed: number;
          total_fees_wei: string;
          earliest_block: string | null;
          latest_block: string | null;
        }>;
    const totals = (Array.isArray(totalsRow) ? totalsRow : totalsRow.rows)[0];

    const aliasRows = (await db.execute(sql`
      SELECT source, COUNT(*)::int AS n
      FROM miner_aliases
      GROUP BY source
    `)) as unknown as
      | { rows: Array<{ source: string; n: number }> }
      | Array<{ source: string; n: number }>;
    const aliasCounts = Array.isArray(aliasRows) ? aliasRows : aliasRows.rows;

    // Coverage = mapped vs total miners observed
    const coverage = (await db.execute(sql`
      SELECT
        COUNT(DISTINCT epf.miner_address) FILTER (WHERE ma.validator_id IS NOT NULL)::int AS mapped,
        COUNT(DISTINCT epf.miner_address) FILTER (WHERE ma.validator_id IS NULL)::int     AS unmapped
      FROM epoch_priority_fees epf
      LEFT JOIN miner_aliases ma ON ma.miner_address = epf.miner_address
    `)) as unknown as
      | { rows: Array<{ mapped: number; unmapped: number }> }
      | Array<{ mapped: number; unmapped: number }>;
    const cov = (Array.isArray(coverage) ? coverage : coverage.rows)[0];

    const totalsBlocksIndexed = totals?.blocks_indexed ?? 0;
    const lastBlock = cursor ? BigInt(cursor.lastBlock) : null;
    const lag = head && lastBlock ? Number(head - lastBlock) : null;

    const response = NextResponse.json({
      cursor: cursor
        ? {
            lastBlock: lastBlock!.toString(),
            lastEpoch: cursor.lastEpoch,
            updatedAt: cursor.updatedAt,
          }
        : null,
      chainHead: head ? head.toString() : null,
      lagBlocks: lag,
      lagSeconds: lag != null ? lag : null, // ~1 block/sec on Monad
      totals: totals
        ? {
            rows: totals.rows,
            uniqueMiners: totals.unique_miners,
            epochsCovered: totals.epochs_covered,
            blocksIndexed: totalsBlocksIndexed,
            totalPriorityFeesWei: totals.total_fees_wei,
            totalPriorityFeesMon: Number(BigInt(totals.total_fees_wei) / BigInt(1e9)) / 1e9,
            earliestBlock: totals.earliest_block,
            latestBlock: totals.latest_block,
          }
        : null,
      minerAliases: {
        total: aliasCounts.reduce((s, r) => s + Number(r.n), 0),
        bySource: Object.fromEntries(aliasCounts.map((r) => [r.source, Number(r.n)])),
      },
      coverage: {
        mapped: cov?.mapped ?? 0,
        unmapped: cov?.unmapped ?? 0,
        ratio:
          cov && cov.mapped + cov.unmapped > 0
            ? cov.mapped / (cov.mapped + cov.unmapped)
            : null,
      },
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=30, stale-while-revalidate=60"
    );
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
