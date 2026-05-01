import { NextResponse } from "next/server";
import { getLiveMonPrice } from "@/lib/price";

/**
 * GET /api/v1/price
 *
 * Live MON/USD price with multi-source fallback (CoinGecko → CMC → Bybit →
 * Coinbase). 60s in-memory cache. Edge cache 30s for deflection. This is
 * the canonical "what is MON worth right now" endpoint — every UI that
 * needs a fresh price should poll this rather than reading the DB column.
 *
 * Response:
 *   {
 *     "monPriceUsd": 0.02954,
 *     "source": "coingecko",
 *     "ageMs": 12345,
 *     "asOf": "2026-05-01T00:00:00Z"
 *   }
 *
 * On total source failure, returns 503 with a diagnostic body listing
 * which sources were tried and why each failed.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const r = await getLiveMonPrice();

  if (!r.price || r.price <= 0) {
    return NextResponse.json(
      {
        error: "All price sources failed",
        attempts: r.attempts,
      },
      { status: 503 }
    );
  }

  const response = NextResponse.json({
    monPriceUsd: r.price,
    source: r.source,
    ageMs: r.ageMs,
    asOf: new Date().toISOString(),
  });
  response.headers.set("X-API-Version", "v1");
  response.headers.set(
    "Cache-Control",
    "public, s-maxage=30, stale-while-revalidate=60"
  );
  return response;
}
