import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validators } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

/**
 * GET /api/validators
 * Lists all validators with their latest metadata.
 */
export async function GET() {
  try {
    const rows = await db
      .select()
      .from(validators)
      .orderBy(desc(validators.stakeMon));

    return NextResponse.json({
      validators: rows.map((v) => ({
        validatorId: v.validatorId,
        name: v.name || `Validator #${v.validatorId}`,
        authAddress: v.authAddress,
        stakeMon: Number(v.stakeMon) || 0,
        commissionPct: Number(v.commissionPct) || 0,
        lastEpoch: v.lastEpoch,
      })),
      count: rows.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
