import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/v1/validators/[id]/lifetime
 *
 * Convenience wrapper around `/api/v1/validators/[id]/realized-report` with
 * no date filter (= all time). Returns the full income history from real
 * on-chain ClaimRewards events + auth_unclaimed deltas.
 *
 * Used to proxy through the now-deprecated `/api/validators/[id]/income?epochs=10000`
 * — that endpoint computed commission via pool × commission_rate which
 * overcounted by 2-5x. Same shape now sourced from realized-report.
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
  const upstream = `${origin}/api/v1/validators/${validatorId}/realized-report`;
  const apiKey = req.headers.get("x-api-key");
  const headers: HeadersInit = {};
  if (apiKey) headers["x-api-key"] = apiKey;

  const r = await fetch(upstream, { headers, cache: "no-store" });
  const body = await r.text();
  const res = new NextResponse(body, {
    status: r.status,
    headers: {
      "Content-Type": r.headers.get("content-type") ?? "application/json",
    },
  });
  res.headers.set("X-API-Version", "v1");
  res.headers.set(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=600"
  );
  return res;
}
