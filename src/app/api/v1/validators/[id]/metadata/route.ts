import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validatorMetadata } from "@/lib/db/metadata";
import { eq } from "drizzle-orm";

/**
 * GET /api/v1/validators/[id]/metadata
 *
 * Public read of operator-claimable metadata. Returns null fields when
 * the validator hasn't claimed yet. Never exposes the claim secret hash.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const validatorId = parseInt(id, 10);
  if (!Number.isFinite(validatorId)) {
    return NextResponse.json({ error: "Invalid validator id" }, { status: 400 });
  }

  try {
    const [row] = await db
      .select()
      .from(validatorMetadata)
      .where(eq(validatorMetadata.validatorId, validatorId))
      .limit(1);

    if (!row) {
      return NextResponse.json({
        validatorId,
        slug: null,
        displayName: null,
        description: null,
        website: null,
        twitter: null,
        discord: null,
        logoUrl: null,
        verified: false,
        claimed: false,
      });
    }

    const response = NextResponse.json({
      validatorId: row.validatorId,
      slug: row.slug,
      displayName: row.displayName,
      description: row.description,
      website: row.website,
      twitter: row.twitter,
      discord: row.discord,
      logoUrl: row.logoUrl,
      verified: row.verified,
      claimed: row.claimSecretHash != null,
      updatedAt: row.updatedAt.toISOString(),
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=600"
    );
    response.headers.set("X-API-Version", "v1");
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
