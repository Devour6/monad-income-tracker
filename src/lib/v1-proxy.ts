import { NextResponse } from "next/server";

/**
 * v1 proxy — forwards a request to a stable internal route while
 * stamping `X-API-Version: v1` and `Cache-Control` headers on the
 * response. Keeps v1 contracts isolated from internal route renames.
 *
 * Internal target is on the same origin; we reuse the incoming
 * URL's host so it works in both Vercel and local dev without
 * NEXT_PUBLIC_BASE_URL gymnastics.
 */
export async function proxyV1(
  request: Request,
  targetPath: string
): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(targetPath, incoming.origin);
  // Preserve query string
  for (const [k, v] of incoming.searchParams) target.searchParams.set(k, v);

  const upstream = await fetch(target.toString(), {
    headers: {
      // Pass through API key so rate-limit tiers apply
      ...(request.headers.get("x-api-key")
        ? { "x-api-key": request.headers.get("x-api-key")! }
        : {}),
      accept: "application/json",
    },
    // Cache lookup is shared at edge; no cookies needed
    cache: "no-store",
  });

  const body = await upstream.text();
  const res = new NextResponse(body, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") || "application/json",
      "x-api-version": "v1",
      // Edge cache 5 min, swr 10 min — same as underlying routes
      "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
  return res;
}
