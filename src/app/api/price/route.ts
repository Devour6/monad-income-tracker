import { NextResponse } from "next/server";
import { getLiveMonPrice } from "@/lib/price";

/**
 * GET /api/price
 *
 * Live MON/USD with multi-source fallback. Mirror of /api/v1/price for
 * convenient unversioned access. Use /api/v1/price for stable contracts.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const r = await getLiveMonPrice();
  if (!r.price || r.price <= 0) {
    return NextResponse.json(
      { error: "All price sources failed", attempts: r.attempts },
      { status: 503 }
    );
  }
  const response = NextResponse.json({
    monPriceUsd: r.price,
    source: r.source,
    ageMs: r.ageMs,
    asOf: new Date().toISOString(),
  });
  response.headers.set(
    "Cache-Control",
    "public, s-maxage=30, stale-while-revalidate=60"
  );
  return response;
}
