import { NextResponse } from "next/server";

/**
 * DEPRECATED. This endpoint used to compute commission income via
 * `pool_rewards × commission_rate`, which empirically overcounts by 2-5x
 * (verified against CFO records and the staking precompile's
 * getDelegator(valId, authAddr).slot2 ground truth).
 *
 * Use `/api/v1/validators/[id]/realized-report` instead. Same data, real
 * on-chain claim events + auth_unclaimed deltas, no rate-based modeling.
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
