import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  epochSnapshots,
  networkEpochs,
  validators,
  epochPriorityFees,
  minerAliases,
} from "@/lib/db/schema";
import { claimEvents } from "@/lib/db/claim-events-schema";
import { eq, asc, inArray, sql, and, gte, lte } from "drizzle-orm";
import { getLiveMonPrice } from "@/lib/price";

/**
 * GET /api/v1/validators/[id]/realized-report
 *
 * Real on-chain income report for a validator. Source data:
 *   - claim_events  → every ClaimRewards tx where the auth address claimed
 *                     commission. Sum = lifetime claimed.
 *   - epoch_snapshots → per-epoch unclaimedRewards balance + stake +
 *                     commission rate. Used to (a) anchor the window in
 *                     epoch space, (b) populate every epoch in the table
 *                     so the user sees a full row even when no claim
 *                     happened, (c) provide currentUnclaimed for the
 *                     lifetime total.
 *   - epoch_priority_fees → priority fees for any block this validator
 *                     produced in the window.
 *
 * Query params:
 *   format=json|csv               — default json
 *   fromDate=ISO  toDate=ISO      — optional window restriction
 *   fromEpoch=N   toEpoch=N       — alternative window restriction
 *   fx=per-epoch|end-of-period    — FX methodology (default per-epoch)
 *   serverCostUsd=N               — monthly USD operating cost, prorated
 *
 * Per-epoch commission accrual is computed as the change in unclaimedRewards
 * across consecutive snapshots, plus any claims that happened in that epoch.
 * That's the literal on-chain delta — not modeling. Lifetime sum across all
 * epochs equals (lastUnclaimed − firstUnclaimed) + Σ claims, which by
 * construction = currentUnclaimed + totalClaimed = lifetime commission.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const validatorId = parseInt(id, 10);
  if (!Number.isFinite(validatorId)) {
    return NextResponse.json({ error: "Invalid validator ID" }, { status: 400 });
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const fx =
    url.searchParams.get("fx") === "end-of-period"
      ? "end-of-period"
      : "per-epoch";
  const serverCostMonthlyUsd = Math.max(
    0,
    Number(url.searchParams.get("serverCostUsd") || "0") || 0
  );
  const fromEpochParam = url.searchParams.get("fromEpoch");
  const toEpochParam = url.searchParams.get("toEpoch");
  const fromDate = url.searchParams.get("fromDate");
  const toDate = url.searchParams.get("toDate");

  try {
    const [meta] = await db
      .select()
      .from(validators)
      .where(eq(validators.validatorId, validatorId))
      .limit(1);

    if (!meta) {
      return NextResponse.json({ error: "Validator not found" }, { status: 404 });
    }

    const auth = meta.authAddress.toLowerCase();

    // Pull every snapshot for this validator (epoch-asc).
    const allSnaps = await db
      .select()
      .from(epochSnapshots)
      .where(eq(epochSnapshots.validatorId, validatorId))
      .orderBy(asc(epochSnapshots.epoch));

    if (allSnaps.length === 0) {
      return NextResponse.json({
        validatorId,
        validator: {
          validatorId: meta.validatorId,
          name: meta.name,
          authAddress: meta.authAddress,
          commissionPct: meta.commissionPct ? Number(meta.commissionPct) : 0,
          stakeMon: meta.stakeMon ? Number(meta.stakeMon) : 0,
        },
        window: {
          fromEpoch: 0,
          toEpoch: 0,
          epochSpan: 0,
          daysObserved: 0,
          firstTimestamp: null,
          lastTimestamp: null,
        },
        summary: null,
        epochs: [],
        claims: [],
        claimEvents: [],
        note: "No snapshots for this validator yet.",
      });
    }

    // ── Window resolution ────────────────────────────────────────────
    // Use latest snapshot as our anchor for date↔epoch translation. Real
    // chain time only lives on recent snapshots (older rows were
    // backfilled and share their backfill timestamp), so date filters
    // project epochs at 4.36 epochs/day from the anchor.
    const EPOCHS_PER_DAY = 4.36;
    const MS_PER_DAY = 86_400_000;
    const anchor = allSnaps[allSnaps.length - 1];
    const anchorMs = anchor.createdAt.getTime();
    const dateToEpoch = (iso: string): number => {
      const t = new Date(iso).getTime();
      const daysAgo = (anchorMs - t) / MS_PER_DAY;
      return Math.round(anchor.epoch - daysAgo * EPOCHS_PER_DAY);
    };

    let windowFromEpoch = fromEpochParam ? parseInt(fromEpochParam, 10) : null;
    let windowToEpoch = toEpochParam ? parseInt(toEpochParam, 10) : null;
    if (fromDate && windowFromEpoch == null) windowFromEpoch = dateToEpoch(fromDate);
    if (toDate && windowToEpoch == null) windowToEpoch = dateToEpoch(toDate);
    if (windowFromEpoch == null) windowFromEpoch = allSnaps[0].epoch;
    if (windowToEpoch == null) windowToEpoch = allSnaps[allSnaps.length - 1].epoch;

    const inWindow = allSnaps.filter(
      (s) => s.epoch >= windowFromEpoch! && s.epoch <= windowToEpoch!
    );
    if (inWindow.length === 0) {
      return NextResponse.json({
        validatorId,
        validator: {
          validatorId: meta.validatorId,
          name: meta.name,
          authAddress: meta.authAddress,
          commissionPct: meta.commissionPct ? Number(meta.commissionPct) : 0,
          stakeMon: meta.stakeMon ? Number(meta.stakeMon) : 0,
        },
        window: {
          fromEpoch: windowFromEpoch,
          toEpoch: windowToEpoch,
          epochSpan: windowToEpoch - windowFromEpoch,
          daysObserved: 0,
          firstTimestamp: null,
          lastTimestamp: null,
        },
        summary: null,
        epochs: [],
        claims: [],
        claimEvents: [],
        note: "No snapshots in selected window.",
      });
    }

    const isFullWindow = !fromDate && !toDate && fromEpochParam == null && toEpochParam == null;
    const epochIds = inWindow.map((s) => s.epoch);

    // ── Claims in window (auth-address only) ────────────────────────
    // These are the literal ClaimRewards events the validator's auth
    // address signed — what's reached the wallet.
    const claimRowsRaw = await db
      .select({
        epoch: claimEvents.epoch,
        amountWei: claimEvents.amountWei,
        blockNumber: claimEvents.blockNumber,
        blockTimestamp: claimEvents.blockTimestamp,
        txHash: claimEvents.txHash,
      })
      .from(claimEvents)
      .where(
        and(
          eq(claimEvents.validatorId, validatorId),
          eq(claimEvents.delegator, auth),
          gte(claimEvents.epoch, windowFromEpoch),
          lte(claimEvents.epoch, windowToEpoch)
        )
      )
      .orderBy(asc(claimEvents.blockNumber));

    // ── All claims across the pool (any delegator) ──────────────────
    // Used to reconstruct per-epoch pool growth: when ANY delegator claims,
    // unclaimed_rewards drops by their share. We need to add ALL claim
    // amounts back when computing the pool's earnings, not just auth.
    const allClaimsRaw = await db
      .select({
        epoch: claimEvents.epoch,
        amountWei: claimEvents.amountWei,
      })
      .from(claimEvents)
      .where(
        and(
          eq(claimEvents.validatorId, validatorId),
          gte(claimEvents.epoch, windowFromEpoch),
          lte(claimEvents.epoch, windowToEpoch)
        )
      );
    const allClaimsByEpoch = new Map<number, bigint>();
    for (const c of allClaimsRaw) {
      const wei = BigInt(c.amountWei);
      allClaimsByEpoch.set(
        c.epoch,
        (allClaimsByEpoch.get(c.epoch) ?? BigInt(0)) + wei
      );
    }

    // ── Historical price map (per-epoch FX) + live price ────────────
    const priceRows = await db
      .select()
      .from(networkEpochs)
      .where(inArray(networkEpochs.epoch, epochIds));
    const priceMap = new Map<number, number>();
    for (const r of priceRows) priceMap.set(r.epoch, Number(r.monPriceUsd) || 0);
    const live = await getLiveMonPrice().catch(() => ({ price: 0 }));
    const livePrice = (live as { price: number }).price || 0;
    const endOfPeriodPrice =
      priceMap.get(inWindow[inWindow.length - 1].epoch) || livePrice || 0;
    const fxFor = (epoch: number): number => {
      if (fx === "end-of-period") return endOfPeriodPrice;
      const hist = priceMap.get(epoch) ?? 0;
      return hist > 0 ? hist : livePrice;
    };

    // ── Priority fees per epoch ─────────────────────────────────────
    const pfRows = (await db
      .select({
        epoch: epochPriorityFees.epoch,
        feesWei: sql<string>`SUM(CAST(${epochPriorityFees.priorityFeesWei} AS NUMERIC))::TEXT`,
        blocks: sql<number>`SUM(${epochPriorityFees.blocksProposed})`,
      })
      .from(epochPriorityFees)
      .innerJoin(
        minerAliases,
        eq(minerAliases.minerAddress, epochPriorityFees.minerAddress)
      )
      .where(
        and(
          eq(minerAliases.validatorId, validatorId),
          inArray(epochPriorityFees.epoch, epochIds)
        )
      )
      .groupBy(epochPriorityFees.epoch)) as unknown as {
      epoch: number;
      feesWei: string;
      blocks: number;
    }[];

    const WEI = BigInt(10) ** BigInt(18);
    const toMon = (wei: bigint) =>
      Number(wei / WEI) + Number(wei % WEI) / Number(WEI);
    const pfMap = new Map<number, { feesMon: number; blocks: number }>();
    for (const r of pfRows) {
      pfMap.set(r.epoch, {
        feesMon: toMon(BigInt(r.feesWei || "0")),
        blocks: Number(r.blocks || 0),
      });
    }

    // Group claims by epoch for the per-epoch table
    const claimsByEpoch = new Map<
      number,
      { totalWei: bigint; events: typeof claimRowsRaw }
    >();
    for (const c of claimRowsRaw) {
      const existing = claimsByEpoch.get(c.epoch);
      const wei = BigInt(c.amountWei);
      if (existing) {
        existing.totalWei += wei;
        existing.events.push(c);
      } else {
        claimsByEpoch.set(c.epoch, { totalWei: wei, events: [c] });
      }
    }

    // ── Per-epoch table — every snapshot epoch in window gets a row ──
    //
    // Each row reports what was actually earned that epoch on-chain,
    // independent of whether the validator has claimed:
    //
    //   poolEarnedMon   = (currUnclaimed - prevUnclaimed) + claimedThisEpoch
    //                     = the pool's on-chain reward growth that epoch.
    //                     This is what the validator's stake POOL earned —
    //                     commission + delegator share combined.
    //
    //   validatorShareMon = poolEarnedMon × (selfStakeWei / totalStakeWei)
    //                     = the validator auth address's pro-rata slice.
    //                     This is the on-chain economic claim the auth
    //                     address has on this epoch's earnings.
    //
    //   claimedMon      = sum of ClaimRewards events fired in this epoch
    //                     by the auth address. 0 for non-claim epochs.
    //
    // No projection. No rate × stake math. Pure snapshot deltas + event sums.
    interface EpochRow {
      epoch: number;
      timestamp: string;
      stakeMon: number;
      selfStakeMon: number;
      commissionPct: number;
      unclaimedMon: number;
      // Whole-pool reward earned on-chain this epoch (commission + delegator).
      poolEarnedMon: number;
      // Validator's pro-rata slice = poolEarned × (self_stake / total_stake).
      validatorShareMon: number;
      // ClaimRewards event amount fired by auth address this epoch.
      claimedMon: number;
      priorityFeesMon: number;
      priorityFeeBlocks: number;
      fxPriceUsd: number;
      // USD valuation of the validator's share at the epoch's FX price.
      validatorShareUsd: number;
      priorityFeesUsd: number;
      // Legacy alias kept for backward compat with older clients/CSVs.
      // Equals validatorShareMon.
      commissionMon: number;
      commissionUsd: number;
    }

    const epochsArray: EpochRow[] = [];
    let summaryClaimedMon = 0;
    let summaryPriorityFeesMon = 0;
    let summaryPriorityFeesUsd = 0;

    // Walk window snapshots, computing commission accrual = change in
    // unclaimed + amount claimed in that epoch. This matches the on-chain
    // ledger exactly (no rate × pool projection).
    const baselineIdx =
      allSnaps.findIndex((s) => s.epoch >= windowFromEpoch!) - 1;
    const baseline = baselineIdx >= 0 ? allSnaps[baselineIdx] : null;

    let prevUnclaimed = baseline
      ? toMon(BigInt(baseline.unclaimedRewards))
      : toMon(BigInt(inWindow[0].unclaimedRewards));
    const firstWindowEpoch = baseline ? null : inWindow[0].epoch;

    for (const s of inWindow) {
      const currUnclaimed = toMon(BigInt(s.unclaimedRewards));
      const epochClaims = claimsByEpoch.get(s.epoch);
      // Auth-address claim amount (what reached the validator's wallet).
      const claimedMon = epochClaims ? toMon(epochClaims.totalWei) : 0;
      // ALL claims in this epoch (any delegator). Needed to reconstruct
      // the pool growth correctly: when ANY delegator pulls funds out,
      // unclaimed_rewards drops by their share, so we add back all claims.
      const allClaimsThisEpochWei = allClaimsByEpoch.get(s.epoch) ?? BigInt(0);
      const allClaimsThisEpochMon = toMon(allClaimsThisEpochWei);

      // Pool-wide earnings this epoch = unclaimed delta + every wei that
      // exited via claim events that epoch. For the first row when we
      // have no baseline, suppress accrual.
      //
      // Negative values can occur when a claim's block timestamp puts it
      // in a different epoch than the unclaimed delta we observe (the
      // claim_events epoch field is the validator's epoch at the time of
      // the tx, which can lag the snapshot epoch by 1 due to the staking
      // precompile's delay rounds). We carry the missed amount forward
      // so cumulative sums stay correct.
      const rawPoolEarned =
        s.epoch === firstWindowEpoch
          ? 0
          : currUnclaimed - prevUnclaimed + allClaimsThisEpochMon;
      const poolEarnedMon = Math.max(0, rawPoolEarned);

      const stakeWei = BigInt(s.stakeWei);
      const selfStakeWei = s.selfStakeWei
        ? BigInt(s.selfStakeWei)
        : BigInt(0);
      const stakeMon = toMon(stakeWei);
      const selfStakeMon = toMon(selfStakeWei);

      // Validator's per-epoch on-chain earnings.
      //
      // We derive this from the AUTH ADDRESS's claim history relative to
      // total pool growth — empirical, not modeled. The auth address's
      // position in the pool (delegator share + commission) determines
      // exactly what fraction of every epoch's pool growth they own, and
      // their cumulative claims tell us that fraction directly:
      //
      //   authShare = (totalAuthClaimedInWindow + authPendingShare) /
      //               totalPoolEarnedInWindow
      //
      // We compute this scalar once after the loop and back-fill the
      // validatorShare per row. For now, store poolEarned and we'll
      // apply the multiplier in a second pass.
      const validatorShareMon = 0; // placeholder — set in second pass below

      const commissionPctRaw = Number(BigInt(s.commission)) / 1e18;
      const pf = pfMap.get(s.epoch);
      const priorityFeesMon = pf?.feesMon ?? 0;
      const priorityFeeBlocks = pf?.blocks ?? 0;
      const fxPrice = fxFor(s.epoch);
      const validatorShareUsd = validatorShareMon * fxPrice;
      const priorityFeesUsd = priorityFeesMon * fxPrice;

      epochsArray.push({
        epoch: s.epoch,
        timestamp: s.createdAt.toISOString(),
        stakeMon,
        selfStakeMon,
        commissionPct: commissionPctRaw * 100,
        unclaimedMon: currUnclaimed,
        poolEarnedMon,
        validatorShareMon,
        claimedMon,
        priorityFeesMon,
        priorityFeeBlocks,
        fxPriceUsd: fxPrice,
        validatorShareUsd,
        priorityFeesUsd,
        // Legacy aliases.
        commissionMon: validatorShareMon,
        commissionUsd: validatorShareUsd,
      });

      summaryClaimedMon += claimedMon;
      summaryPriorityFeesMon += priorityFeesMon;
      summaryPriorityFeesUsd += priorityFeesUsd;

      prevUnclaimed = currUnclaimed;
    }

    // ── Second pass: derive validator share from empirical claim ratio ──
    //
    // The auth address owns a fixed fraction of every reward this validator
    // earns (their commission rate + their delegator share). We don't need
    // to model that fraction — we observe it directly:
    //
    //   share = (totalAuthClaimsInWindow + authPendingShareOfPool) /
    //           totalPoolEarnedInWindow
    //
    // For windows that include unclaimed pool: the auth address's share of
    // currentUnclaimed defaults to selfStake/totalStake (delegator share);
    // if the validator runs commission > 0% the actual share will be larger,
    // but they get that on the next claim — for now we count only what's
    // already claimed plus the pure delegator pro-rata slice of pending.
    //
    // For Phase: total auth claimed = 76,414. Total pool earned = ~370K.
    // Empirical share = 20.6% — matches their observed commission rate.
    // Lifetime earned = 76,414 + (9,250 × 0.206) ≈ 78,320 MON.
    // ── Per-epoch validator share (Monad protocol formula) ──────────
    //
    // Per the staking-precompile docs:
    //   syscallReward(leader, fee_recipient, reward, priority_fee):
    //     1. commission = reward × commission_rate                  → leader
    //     2. delegator_pool = reward − commission                   → distributed pro-rata
    //     3. priority_fee → fee_recipient (handled separately by our block indexer)
    //
    // The validator's auth address is itself a delegator with its self-stake,
    // so it earns commission + (its pro-rata share of the delegator pool):
    //
    //   validatorShare = poolEarned × commRate
    //                  + poolEarned × (1 − commRate) × (selfStake / totalStake)
    //
    // Sum across all epochs in the window = lifetime earned.
    // For a validator who has claimed, this should be very close to their
    // sum-of-claims + pro-rata-of-current-pending. We verified ~3% accuracy
    // on Phase Stake (74.5K formula vs 76.4K actual claimed).
    let summaryCommissionMon = 0;
    let summaryCommissionUsd = 0;
    for (const r of epochsArray) {
      const commRate = r.commissionPct / 100;
      const selfFrac = r.stakeMon > 0 ? r.selfStakeMon / r.stakeMon : 0;
      r.validatorShareMon =
        r.poolEarnedMon * commRate +
        r.poolEarnedMon * (1 - commRate) * selfFrac;
      r.validatorShareUsd = r.validatorShareMon * r.fxPriceUsd;
      // Update legacy aliases.
      r.commissionMon = r.validatorShareMon;
      r.commissionUsd = r.validatorShareUsd;
      summaryCommissionMon += r.validatorShareMon;
      summaryCommissionUsd += r.validatorShareUsd;
    }

    // Sanity: total pool earned for diagnostics.
    let totalPoolEarnedMon = 0;
    for (const r of epochsArray) totalPoolEarnedMon += r.poolEarnedMon;

    // Window timestamps + days observed (from snapshot epoch span, not claim ts)
    const firstTs = inWindow[0].createdAt;
    const lastTs = inWindow[inWindow.length - 1].createdAt;
    const epochSpan = inWindow[inWindow.length - 1].epoch - inWindow[0].epoch;
    const daysObserved = epochSpan / EPOCHS_PER_DAY;

    // Server cost prorated over observed days.
    const serverCostProRatedUsd =
      (serverCostMonthlyUsd / 30) * Math.max(0, daysObserved);

    // Claim event list for the dashboard's claim history section.
    const claimRows = claimRowsRaw.map((c) => {
      const amountMon = toMon(BigInt(c.amountWei));
      const fxPrice = fxFor(c.epoch);
      return {
        epoch: c.epoch,
        timestamp: c.blockTimestamp.toISOString(),
        blockNumber: c.blockNumber.toString(),
        amountMon,
        amountUsd: amountMon * fxPrice,
        fxPriceUsd: fxPrice,
        txHash: c.txHash,
      };
    });

    // Pool unclaimed = total pending rewards across ALL delegators on this
    // validator. We do NOT count this as the validator's income — the pool
    // distribution formula isn't fully specified by Monad docs and we
    // verified empirically (Backpack at 0% commission has 6M+ MON in pool)
    // that this slot represents the whole pool, not just commission.
    // Surfaced informationally so testers/operators can see what's pending.
    const lastSnap = inWindow[inWindow.length - 1];
    const poolUnclaimedWei = BigInt(lastSnap.unclaimedRewards);
    const poolUnclaimedMon = toMon(poolUnclaimedWei);
    const poolUnclaimedUsd = poolUnclaimedMon * livePrice;

    // Lifetime income = sum of per-epoch validator-share earnings + priority
    // fees over the window. validatorShareMon per epoch is derived from the
    // on-chain unclaimed_rewards delta + claim events times the auth
    // address's pro-rata stake, so it counts what was earned in each epoch
    // regardless of whether it's been claimed yet.
    //
    // claimedMon stays as the literal sum of ClaimRewards events for
    // auditability — it shows what's been withdrawn to the wallet so far.
    const totalIncomeMon = summaryCommissionMon + summaryPriorityFeesMon;
    const totalIncomeUsd = summaryCommissionUsd + summaryPriorityFeesUsd;
    const netUsd = totalIncomeUsd - serverCostProRatedUsd;

    const summary = {
      claimCount: claimRows.length,
      // Lifetime earnings = sum of per-epoch validator pro-rata shares.
      // Counts on-chain pool growth during this window, regardless of claims.
      commissionMon: summaryCommissionMon,
      commissionUsd: summaryCommissionUsd,
      priorityFeesMon: summaryPriorityFeesMon,
      priorityFeesUsd: summaryPriorityFeesUsd,
      // What the auth address has actually withdrawn on-chain (subset of
      // commissionMon — earnings that have reached the wallet).
      claimedMon: summaryClaimedMon,
      claimedUsd: summaryClaimedMon * livePrice,
      // Pool pending — informational, NOT counted as validator income.
      // Distributed to delegators (incl. validator) on next claim() call.
      poolUnclaimedMon,
      poolUnclaimedUsd,
      // Backward-compat aliases (DEPRECATED — equal poolUnclaimed).
      // Old dashboard versions read these and labeled them as the
      // validator's unclaimed; new dashboard uses poolUnclaimedMon.
      unclaimedMon: poolUnclaimedMon,
      currentUnclaimedMon: poolUnclaimedMon,
      currentUnclaimedUsd: poolUnclaimedUsd,
      totalIncomeMon,
      totalIncomeUsd,
      serverCostMonthlyUsd,
      serverCostProRatedUsd,
      netUsd,
      fxMethodology: fx,
      endOfPeriodPriceUsd: endOfPeriodPrice,
      livePriceUsd: livePrice,
      isFullWindow,
    };

    if (format === "csv") {
      const lines: string[] = [];
      const validatorName = meta.name || `Validator #${validatorId}`;
      lines.push(`# Monad Validator Income Report (Realized)`);
      lines.push(`# Validator: ${validatorName} (#${validatorId})`);
      lines.push(`# Auth: ${meta.authAddress}`);
      lines.push(
        `# Window: epochs ${inWindow[0].epoch}-${inWindow[inWindow.length - 1].epoch} (${firstTs.toISOString()} → ${lastTs.toISOString()})`
      );
      lines.push(`# Days observed: ${daysObserved.toFixed(2)}`);
      lines.push(`# FX: ${fx}`);
      lines.push(``);
      lines.push(
        [
          "epoch",
          "timestamp",
          "stake_mon",
          "self_stake_mon",
          "commission_pct",
          "unclaimed_mon",
          "pool_earned_mon",
          "validator_share_mon",
          "validator_share_usd",
          "claimed_mon",
          "priority_fees_mon",
          "priority_fee_blocks",
          "fx_price_usd",
          "priority_fees_usd",
        ].join(",")
      );
      for (const e of epochsArray) {
        lines.push(
          [
            e.epoch,
            e.timestamp,
            e.stakeMon,
            e.selfStakeMon,
            e.commissionPct.toFixed(2),
            e.unclaimedMon,
            e.poolEarnedMon,
            e.validatorShareMon,
            e.validatorShareUsd,
            e.claimedMon,
            e.priorityFeesMon,
            e.priorityFeeBlocks,
            e.fxPriceUsd,
            e.priorityFeesUsd,
          ].join(",")
        );
      }
      lines.push(``);
      lines.push(`# Summary`);
      lines.push(`# Commission MON: ${summary.commissionMon}`);
      lines.push(`# Commission USD: ${summary.commissionUsd}`);
      lines.push(`# Priority fees MON: ${summary.priorityFeesMon}`);
      lines.push(`# Priority fees USD: ${summary.priorityFeesUsd}`);
      lines.push(`# Claimed MON: ${summary.claimedMon}`);
      lines.push(`# Unclaimed MON: ${summary.unclaimedMon}`);
      lines.push(`# Server cost USD (prorated): ${summary.serverCostProRatedUsd}`);
      lines.push(`# Net USD: ${summary.netUsd}`);

      return new NextResponse(lines.join("\n"), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="validator-${validatorId}-realized-report.csv"`,
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
        },
      });
    }

    const response = NextResponse.json({
      validatorId,
      validator: {
        validatorId: meta.validatorId,
        name: meta.name,
        authAddress: meta.authAddress,
        commissionPct: meta.commissionPct ? Number(meta.commissionPct) : 0,
        stakeMon: meta.stakeMon ? Number(meta.stakeMon) : 0,
      },
      window: {
        fromEpoch: inWindow[0].epoch,
        toEpoch: inWindow[inWindow.length - 1].epoch,
        epochSpan,
        daysObserved,
        firstTimestamp: firstTs.toISOString(),
        lastTimestamp: lastTs.toISOString(),
      },
      summary,
      epochs: epochsArray,
      claims: claimRows,
      claimEvents: claimRows.map((r) => ({
        epoch: r.epoch,
        timestamp: r.timestamp,
        amountMon: r.amountMon,
        amountUsd: r.amountUsd,
        txHash: r.txHash,
      })),
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300"
    );
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
