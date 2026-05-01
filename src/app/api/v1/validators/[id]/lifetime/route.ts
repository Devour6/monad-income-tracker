import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/v1/validators/[id]/lifetime
 *
 * Convenience wrapper that fetches the validator's full income window —
 * everything we have snapshots for — by passing a very large epoch cap to
 * the underlying income route. Frontends use this for lifetime totals so
 * they don't have to know how far back the backfill has reached.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const validatorId = parseInt(id, 10);
  if (!Number.isFinite(validatorId)) {
    return NextResponse.json({ error: "Invalid validator ID" }, { status: 400 });
  }

  const origin = req.nextUrl.origin;
  const upstream = `${origin}/api/validators/${validatorId}/income?epochs=10000`;
  const apiKey = req.headers.get("x-api-key");
  const headers: HeadersInit = {};
  if (apiKey) headers["x-api-key"] = apiKey;

  const r = await fetch(upstream, { headers, cache: "no-store" });
  const body = await r.text();
  const res = new NextResponse(body, {
    status: r.status,
    headers: { "Content-Type": r.headers.get("content-type") ?? "application/json" },
  });
  res.headers.set("X-API-Version", "v1");
  res.headers.set(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=600"
  );
  return res;
}
