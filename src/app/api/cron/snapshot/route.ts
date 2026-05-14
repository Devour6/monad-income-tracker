import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epochSnapshots, validators, networkEpochs } from "@/lib/db/schema";
import {
  getEpoch,
  getAllValidatorIds,
  getValidators,
  getMonPrice,
  calculateEpochReward,
  getDelegatorState,
} from "@/lib/monad-rpc";
import { eq, sql, desc } from "drizzle-orm";
import { VALIDATOR_NAMES, fetchFreshRegistry } from "@/data/validator-names";

/**
 * Cron endpoint: Snapshots all validator accRewardPerToken values for the current epoch.
 * Runs every 6 hours via Vercel Cron.
 *
 * Flow:
 * 1. Get current epoch from precompile
 * 2. Check if we already have a snapshot for this epoch
 * 3. Fetch all consensus validators
 * 4. Batch-fetch validator data (stake, accRewardPerToken, commission)
 * 5. Store snapshots and compute income deltas from previous epoch
 * 6. Update validator metadata
 */
export async function GET(request: Request) {
  // Verify cron secret (Vercel sends this header)
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Get current epoch
    const { epoch, inDelayPeriod } = await getEpoch();
    console.log(
      `[snapshot] Current epoch: ${epoch}, inDelayPeriod: ${inDelayPeriod}`
    );

    // Skip if we're in the delay period (validator set is transitioning)
    if (inDelayPeriod) {
      return NextResponse.json({
        status: "skipped",
        reason: "in_epoch_delay_period",
        epoch,
      });
    }

    // 2. Check if we already have this epoch
    const existing = await db
      .select({ id: epochSnapshots.id })
      .from(epochSnapshots)
      .where(eq(epochSnapshots.epoch, epoch))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({
        status: "skipped",
        reason: "epoch_already_snapshotted",
        epoch,
      });
    }

    // 3. Fetch all active validator IDs via execution set (up to 200)
    const validatorIds = await getAllValidatorIds(false);
    console.log(`[snapshot] Found ${validatorIds.length} active validators`);

    // 4. Fetch all validator data
    const validatorData = await getValidators(validatorIds);
    console.log(`[snapshot] Fetched data for ${validatorData.length} validators`);

    // 5. Get MON price + fresh registry + per-validator auth delegator state
    //    (self-stake + auth pending unclaimed). One getDelegator(valId, auth)
    //    call per validator captures both slots: stake (self-stake) and
    //    totalRewards (= pending claimable). The pending number is the
    //    on-chain truth for "what would claimRewards pay out right now" and
    //    feeds the income report endpoint directly — no derivation.
    const [monPrice, nameRegistry, delegatorMap] = await Promise.all([
      getMonPrice(),
      fetchFreshRegistry().catch(() => VALIDATOR_NAMES),
      getDelegatorState(
        validatorData.map((v) => ({
          validatorId: v.validatorId,
          authAddress: v.authAddress,
        }))
      ).catch((err) => {
        console.log("[snapshot] getDelegatorState failed:", err);
        return new Map<number, { stakeWei: bigint; unclaimedWei: bigint }>();
      }),
    ]);
    const selfStakeMap = new Map<number, bigint>();
    const authUnclaimedMap = new Map<number, bigint>();
    for (const [vid, st] of delegatorMap.entries()) {
      selfStakeMap.set(vid, st.stakeWei);
      authUnclaimedMap.set(vid, st.unclaimedWei);
    }
    console.log(
      `[snapshot] Fetched delegator state for ${delegatorMap.size}/${validatorData.length} validators`
    );

    // 6. Get the most recent previous epoch's snapshots for delta computation
    // (epochs may not be consecutive if the cron skips some)
    const prevEpochRow = await db
      .select({ epoch: epochSnapshots.epoch })
      .from(epochSnapshots)
      .where(sql`${epochSnapshots.epoch} < ${epoch}`)
      .orderBy(desc(epochSnapshots.epoch))
      .limit(1);

    let prevMap = new Map<number, typeof epochSnapshots.$inferSelect>();
    if (prevEpochRow.length > 0) {
      const prevSnapshots = await db
        .select()
        .from(epochSnapshots)
        .where(eq(epochSnapshots.epoch, prevEpochRow[0].epoch));
      prevMap = new Map(
        prevSnapshots.map((s) => [s.validatorId, s])
      );
      console.log(`[snapshot] Using epoch ${prevEpochRow[0].epoch} as previous (current: ${epoch})`);
    } else {
      console.log(`[snapshot] No previous epoch found — first snapshot, skipping delta computation`);
    }

    // 7. Insert epoch snapshots with income computation
    let totalNetworkStake = 0;
    const snapshotRows: (typeof epochSnapshots.$inferInsert)[] = [];
    const validatorRows: (typeof validators.$inferInsert)[] = [];

    for (const v of validatorData) {
      let blockRewardsMon: string | null = null;
      let commissionMon: string | null = null;

      // Compute delta from previous epoch if available
      const prev = prevMap.get(v.validatorId);
      if (prev) {
        const prevAcc = BigInt(prev.accRewardPerToken);
        // Use previous epoch's stake — that's the stake that earned the rewards
        const prevStakeWei = BigInt(prev.stakeWei);
        const { totalRewardMon } = calculateEpochReward(
          prevAcc,
          v.accRewardPerToken,
          prevStakeWei
        );

        if (totalRewardMon > 0) {
          // Commission is on-chain as 18-decimal fixed-point (e.g. 200000000000000000 = 20%)
          const commissionRate = Number(v.commission) / 1e18;
          const commIncome = totalRewardMon * commissionRate;
          blockRewardsMon = totalRewardMon.toFixed(18);
          commissionMon = commIncome.toFixed(18);
        }
      }

      const selfStakeWei = selfStakeMap.get(v.validatorId);

      snapshotRows.push({
        epoch,
        validatorId: v.validatorId,
        accRewardPerToken: v.accRewardPerToken.toString(),
        stakeWei: v.stakeWei.toString(),
        commission: v.commission.toString(),
        unclaimedRewards: v.unclaimedRewards.toString(),
        selfStakeWei: selfStakeWei != null ? selfStakeWei.toString() : null,
        blockRewardsMon,
        commissionMon,
      });

      totalNetworkStake += v.stakeMon;

      // Prepare validator metadata update
      const name = nameRegistry[v.validatorId]?.name ?? null;
      // Commission from on-chain: 18-decimal fixed-point → percentage
      const commPct = Number(v.commission) / 1e18 * 100;

      validatorRows.push({
        validatorId: v.validatorId,
        authAddress: v.authAddress,
        name,
        stakeMon: v.stakeMon.toFixed(2),
        commissionPct: commPct.toFixed(2),
        lastEpoch: epoch,
      });
    }

    // 8. Batch insert snapshots
    if (snapshotRows.length > 0) {
      // Insert in batches to avoid query size limits
      for (let i = 0; i < snapshotRows.length; i += 50) {
        const batch = snapshotRows.slice(i, i + 50);
        await db.insert(epochSnapshots).values(batch);
      }
    }

    // 8b. Write per-validator auth-address pending unclaimed (slot 2 of
    //     getDelegator) to epoch_snapshots.auth_unclaimed_wei. Strict
    //     on-chain truth — exact "what claimRewards would pay out". Used by
    //     the income report endpoint to compute validator earnings per epoch
    //     without any modeling.
    if (authUnclaimedMap.size > 0) {
      const updates: Array<{ vid: number; wei: string }> = [];
      for (const [vid, wei] of authUnclaimedMap.entries()) {
        updates.push({ vid, wei: wei.toString() });
      }
      // One UPDATE per row — simpler and Drizzle/neon handle the typing
      // automatically. 200ish rows, no measurable overhead vs UNNEST.
      for (const u of updates) {
        await db.execute(sql`
          UPDATE epoch_snapshots
             SET auth_unclaimed_wei = ${u.wei}
           WHERE epoch = ${epoch}
             AND validator_id = ${u.vid}
        `);
      }
      console.log(
        `[snapshot] auth_unclaimed_wei updated for ${updates.length} validators @ epoch ${epoch}`
      );
    }

    // 9. Batch upsert validator metadata (50 at a time to avoid query size limits)
    for (let i = 0; i < validatorRows.length; i += 50) {
      const batch = validatorRows.slice(i, i + 50);
      await db
        .insert(validators)
        .values(batch)
        .onConflictDoUpdate({
          target: validators.validatorId,
          set: {
            authAddress: sql`excluded.auth_address`,
            name: sql`excluded.name`,
            stakeMon: sql`excluded.stake_mon`,
            commissionPct: sql`excluded.commission_pct`,
            lastEpoch: sql`excluded.last_epoch`,
            updatedAt: new Date(),
          },
        });
    }

    // 10. Insert network epoch data
    await db.insert(networkEpochs).values({
      epoch,
      totalStakeMon: totalNetworkStake.toFixed(2),
      activeValidators: validatorData.length,
      monPriceUsd: monPrice > 0 ? monPrice.toFixed(8) : null,
    });

    const withIncome = snapshotRows.filter((s) => s.blockRewardsMon !== null);

    return NextResponse.json({
      status: "success",
      epoch,
      validators: validatorData.length,
      withIncome: withIncome.length,
      totalNetworkStake: Math.round(totalNetworkStake),
      monPrice: monPrice || "unavailable",
    });
  } catch (error) {
    console.error("[snapshot] Error:", error);
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
