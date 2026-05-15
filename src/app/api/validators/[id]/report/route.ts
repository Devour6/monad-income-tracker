import { NextResponse } from "next/server";

/**
 * DEPRECATED. This endpoint used to derive commission income via
 * `pool_rewards × commission_rate`, which overcounts real on-chain commission
 * by 2-5x. Use `/api/v1/validators/[id]/realized-report` instead.
 *
 * Returns HTTP 410 Gone + a pointer to the correct endpoint.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const newUrl = `/api/v1/validators/${id}/realized-report${url.search}`;
  return NextResponse.json(
    {
      error: "endpoint_deprecated",
      reason:
        "This endpoint used a pool × commission_rate estimate that overcounted real on-chain commission by 2-5x. Use the realized-report endpoint, which sums actual ClaimRewards events + auth_unclaimed deltas.",
      replacement: newUrl,
    },
    { status: 410 }
  );
}
