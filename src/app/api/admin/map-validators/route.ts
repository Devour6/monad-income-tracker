import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validators } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { VALIDATOR_NAMES, fetchFreshRegistry } from "@/data/validator-names";

/**
 * Updates all validator names in the DB from the official Monad validator registry.
 * Source: github.com/monad-developers/validator-info
 */
export async function GET() {
  try {
    // Try fetching fresh from GitHub, fall back to embedded
    const registry = await fetchFreshRegistry().catch(() => VALIDATOR_NAMES);

    // Get all validators from DB
    const allValidators = await db.select().from(validators);

    let updated = 0;
    let alreadyNamed = 0;
    let noMatch = 0;

    for (const v of allValidators) {
      const entry = registry[v.validatorId];
      if (entry?.name) {
        const currentName = v.name;
        if (currentName !== entry.name) {
          await db
            .update(validators)
            .set({ name: entry.name, updatedAt: new Date() })
            .where(eq(validators.validatorId, v.validatorId));
          updated++;
        } else {
          alreadyNamed++;
        }
      } else {
        noMatch++;
      }
    }

    return NextResponse.json({
      status: "success",
      registrySize: Object.keys(registry).length,
      dbValidators: allValidators.length,
      updated,
      alreadyNamed,
      noMatch,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
