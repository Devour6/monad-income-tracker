import { NextResponse } from "next/server";
import {
  getAllValidatorIds,
  getValidators,
  getMonPrice,
} from "@/lib/monad-rpc";
import {
  DEFAULT_MON_PRICE,
  DEFAULT_TOTAL_STAKED,
  DEFAULT_ACTIVE_VALIDATORS,
} from "@/lib/constants";

export const revalidate = 300; // ISR: revalidate every 5 minutes

export async function GET() {
  const defaults = {
    monPrice: DEFAULT_MON_PRICE,
    networkStake: DEFAULT_TOTAL_STAKED,
    activeValidators: DEFAULT_ACTIVE_VALIDATORS,
    updatedAt: null,
  };

  try {
    // Fetch MON price and validator data in parallel
    const [monPrice, validatorIds] = await Promise.all([
      getMonPrice(),
      getAllValidatorIds(false), // active validators only for live data
    ]);

    // Fetch all validator stakes
    const validators = await getValidators(validatorIds);
    const networkStake = validators.reduce((sum, v) => sum + v.stakeMon, 0);

    return NextResponse.json({
      monPrice: monPrice > 0 ? monPrice : defaults.monPrice,
      networkStake: Math.round(networkStake),
      activeValidators: validatorIds.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(
      "Live data fetch error:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(defaults);
  }
}
