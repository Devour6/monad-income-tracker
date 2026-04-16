import { NextResponse } from "next/server";
import {
  getConsensusValidatorIds,
  getValidators,
} from "@/lib/monad-rpc";
import { KNOWN_VALIDATORS } from "@/data/validator-names";

/**
 * Maps on-chain validator IDs to known validator names by matching stake amounts.
 * Run once to generate the VALIDATOR_NAMES mapping, then paste it into validator-names.ts.
 *
 * Matching strategy: For each on-chain validator, find the known validator whose
 * totalStake is closest (within 5% tolerance). Stakes shift over time so we use
 * approximate matching.
 */
export async function GET() {
  try {
    const validatorIds = await getConsensusValidatorIds();
    const validators = await getValidators(validatorIds);

    // Sort by stake descending for better matching
    const sorted = [...validators].sort((a, b) => b.stakeMon - a.stakeMon);

    const matched: Array<{
      validatorId: number;
      name: string;
      commission: number;
      onChainStake: number;
      knownStake: number;
      matchPct: number;
    }> = [];

    const unmatched: Array<{
      validatorId: number;
      authAddress: string;
      stake: number;
    }> = [];

    const usedKnown = new Set<number>();

    for (const v of sorted) {
      let bestMatch = -1;
      let bestDiff = Infinity;

      for (let i = 0; i < KNOWN_VALIDATORS.length; i++) {
        if (usedKnown.has(i)) continue;
        const known = KNOWN_VALIDATORS[i];
        const diff = Math.abs(v.stakeMon - known.totalStake);
        const pct = diff / known.totalStake;

        // Within 20% tolerance (stakes change over time)
        if (pct < 0.20 && diff < bestDiff) {
          bestDiff = diff;
          bestMatch = i;
        }
      }

      if (bestMatch >= 0) {
        const known = KNOWN_VALIDATORS[bestMatch];
        usedKnown.add(bestMatch);
        matched.push({
          validatorId: v.validatorId,
          name: known.name,
          commission: known.commission,
          onChainStake: Math.round(v.stakeMon),
          knownStake: Math.round(known.totalStake),
          matchPct: Number(
            ((1 - bestDiff / known.totalStake) * 100).toFixed(1)
          ),
        });
      } else {
        unmatched.push({
          validatorId: v.validatorId,
          authAddress: v.authAddress,
          stake: Math.round(v.stakeMon),
        });
      }
    }

    // Generate the TypeScript mapping code
    const tsCode = matched
      .sort((a, b) => a.validatorId - b.validatorId)
      .map(
        (m) =>
          `  ${m.validatorId}: { name: "${m.name}", commission: ${m.commission} },`
      )
      .join("\n");

    return NextResponse.json({
      matched: matched.length,
      unmatched: unmatched.length,
      total: validators.length,
      mapping: matched.sort((a, b) => a.validatorId - b.validatorId),
      unmatchedValidators: unmatched,
      tsCode: `export const VALIDATOR_NAMES: Record<number, ValidatorInfo> = {\n${tsCode}\n};`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
