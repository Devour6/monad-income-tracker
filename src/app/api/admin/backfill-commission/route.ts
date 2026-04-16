import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validators } from "@/lib/db/schema";
import { getAllValidatorIds, getValidators } from "@/lib/monad-rpc";
import { eq } from "drizzle-orm";

/**
 * One-time backfill: reads on-chain commission for all validators
 * and updates the DB with correct percentage values.
 *
 * Commission on-chain is 18-decimal fixed-point:
 *   200000000000000000 = 0.2 = 20%
 *   100000000000000000 = 0.1 = 10%
 */
export async function GET() {
  try {
    const validatorIds = await getAllValidatorIds(false);
    const validatorData = await getValidators(validatorIds);

    let updated = 0;
    for (const v of validatorData) {
      const commPct = Number(v.commission) / 1e18 * 100;
      await db
        .update(validators)
        .set({ commissionPct: commPct.toFixed(2), updatedAt: new Date() })
        .where(eq(validators.validatorId, v.validatorId));
      updated++;
    }

    // Sample a few to verify
    const samples = validatorData.slice(0, 10).map((v) => ({
      id: v.validatorId,
      commissionRaw: v.commission.toString(),
      commissionPct: (Number(v.commission) / 1e18 * 100).toFixed(2) + "%",
    }));

    return NextResponse.json({
      status: "success",
      updated,
      total: validatorData.length,
      samples,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
