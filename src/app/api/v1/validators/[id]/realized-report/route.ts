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
import { mevPayouts } from "@/lib/db/mev-payouts-schema";
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
          // Use the FULL window range, not the snapshot-existing epochIds.
          // Some epochs may have priority fees indexed but no snapshot
          // (daily snapshot cron occasionally misses an epoch). We don't
          // want to drop those fees from the report — they're real income.
          gte(epochPriorityFees.epoch, windowFromEpoch),
          lte(epochPriorityFees.epoch, windowToEpoch)
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

    // ── shMonad MEV payouts in window ───────────────────────────────
    //
    // Aggregate SendValidatorRewards events from the shMonad proxy. These
    // are the per-block MEV/priority-fee payouts that flow from the
    // validator's Coinbase contract back into the staking precompile.
    //
    //   validatorPayoutWei = MON sent to delegators via externalReward
    //                       (eventually surfaces in claim_events)
    //   feeTakenWei       = shMonad protocol revenue (boost commission)
    //
    // We bound by block_number using the window's first/last snapshot's
    // block estimate — since mev_payouts has block-level granularity and
    // snapshots don't, we approximate via the chain-time anchor.
    //
    // For an "all time" view we get every MEV payout for this validator;
    // for a sliced window we bound by block number derived from the
    // window's first/last snapshot timestamps.
    const firstSnapTs = inWindow[0].createdAt;
    const lastSnapTs = inWindow[inWindow.length - 1].createdAt;
    // Approximate block range from chain-time anchor + epoch length
    // (50000 blocks per ~5.5h epoch ~= 2.525 blocks per second).
    const BLOCKS_PER_SECOND = 50000 / (5.5 * 3600);
    const tsToBlockApprox = (ts: Date, anchorBlk: bigint, anchorTs: Date): bigint => {
      const secondsDelta = (anchorTs.getTime() - ts.getTime()) / 1000;
      const blocksDelta = BigInt(Math.floor(secondsDelta * BLOCKS_PER_SECOND));
      return anchorBlk - blocksDelta;
    };

    // Find a recent MEV payout block as our anchor (close to chain head).
    const mevAnchorRows = (await db.execute(sql`
      SELECT MAX(block_number)::text AS max_blk, MAX(block_timestamp) AS max_ts
      FROM mev_payouts
    `)) as unknown as { rows?: unknown[] };
    const mevAnchorList = Array.isArray(
      (mevAnchorRows as { rows?: unknown[] }).rows
    )
      ? ((mevAnchorRows as { rows: unknown[] }).rows as Array<{
          max_blk: string | null;
          max_ts: Date | null;
        }>)
      : (mevAnchorRows as unknown as Array<{
          max_blk: string | null;
          max_ts: Date | null;
        }>);

    const mevAnchorBlk =
      mevAnchorList[0]?.max_blk ? BigInt(mevAnchorList[0].max_blk) : null;
    const mevAnchorTs = mevAnchorList[0]?.max_ts
      ? new Date(mevAnchorList[0].max_ts)
      : null;

    let mevSummary = {
      validatorPayoutMon: 0,
      feeTakenMon: 0,
      eventCount: 0,
      perEpoch: new Map<number, { payoutMon: number; feeMon: number; n: number }>(),
    };
    if (mevAnchorBlk != null && mevAnchorTs != null) {
      const fromBlk = tsToBlockApprox(firstSnapTs, mevAnchorBlk, mevAnchorTs);
      const toBlk = tsToBlockApprox(lastSnapTs, mevAnchorBlk, mevAnchorTs);
      // Pad +/-100k blocks to capture edge cases from clock drift.
      const lowBlk = fromBlk - BigInt(100000);
      const highBlk =
        toBlk > mevAnchorBlk ? mevAnchorBlk + BigInt(50000) : toBlk + BigInt(100000);

      const mevRows = await db
        .select({
          payoutWei: mevPayouts.validatorPayoutWei,
          feeWei: mevPayouts.feeTakenWei,
          blockTimestamp: mevPayouts.blockTimestamp,
          blockNumber: mevPayouts.blockNumber,
        })
        .from(mevPayouts)
        .where(
          and(
            eq(mevPayouts.validatorId, validatorId),
            gte(mevPayouts.blockNumber, lowBlk > BigInt(0) ? lowBlk : BigInt(0)),
            lte(mevPayouts.blockNumber, highBlk)
          )
        );

      // Filter precisely to window timestamps + aggregate per-epoch.
      for (const m of mevRows) {
        const ts = m.blockTimestamp.getTime();
        if (
          ts < firstSnapTs.getTime() ||
          ts > lastSnapTs.getTime() + 60_000
        )
          continue;
        const payoutMon = toMon(BigInt(m.payoutWei));
        const feeMon = toMon(BigInt(m.feeWei));
        mevSummary.validatorPayoutMon += payoutMon;
        mevSummary.feeTakenMon += feeMon;
        mevSummary.eventCount += 1;
        // Map to epoch — find the inWindow snapshot whose timestamp is
        // nearest before this MEV event.
        let epochForRow = inWindow[0].epoch;
        for (let i = inWindow.length - 1; i >= 0; i--) {
          if (inWindow[i].createdAt.getTime() <= ts) {
            epochForRow = inWindow[i].epoch;
            break;
          }
        }
        const existing = mevSummary.perEpoch.get(epochForRow);
        if (existing) {
          existing.payoutMon += payoutMon;
          existing.feeMon += feeMon;
          existing.n += 1;
        } else {
          mevSummary.perEpoch.set(epochForRow, {
            payoutMon,
            feeMon,
            n: 1,
          });
        }
      }
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

    // ── EPOCH-BY-EPOCH: cover every epoch in [windowFromEpoch, windowToEpoch],
    //    not just ones with a snapshot.
    //
    // The daily snapshot cron stores ~1 row per validator per day, so a
    // 7-day window often has only 4-7 snapshots covering 30+ epochs. The
    // old loop iterated over snapshots only, leaving most epochs invisible
    // (and lumping a whole day's pool growth into the day's single snapshot).
    //
    // New approach: for every epoch e in the window:
    //   - find the snapshot just BEFORE or AT e (prevSnap) and the snapshot
    //     just AFTER or AT e (nextSnap)
    //   - per-epoch pool growth = (nextSnap.unclaimed − prevSnap.unclaimed
    //                              + sum_of_all_claims_in_(prevSnap, nextSnap])
    //                              / (nextSnap.epoch − prevSnap.epoch)
    //     i.e. distribute the inter-snapshot delta evenly across the gap.
    //   - claimed = claim events with the auth address dated to that epoch
    //   - stake / commission rate / self stake = carried from prevSnap
    //   - timestamp = prevSnap.createdAt + (e − prevSnap.epoch) × epochLenMs
    //
    // This makes the per-epoch table dense and matches what the validator
    // actually earned on-chain even when our cron only snapshots once/day.
    const baselineIdx =
      allSnaps.findIndex((s) => s.epoch >= windowFromEpoch!) - 1;
    const baseline = baselineIdx >= 0 ? allSnaps[baselineIdx] : null;
    const orderedSnaps: typeof allSnaps = [];
    if (baseline) orderedSnaps.push(baseline);
    for (const s of inWindow) orderedSnaps.push(s);

    const EPOCH_LEN_MS = (1 / EPOCHS_PER_DAY) * 86_400_000;
    // Estimate the chain time of an epoch from the closest snapshot anchor.
    // Reuse `anchor` declared above for date→epoch translation.
    const epochTimestamp = (e: number): string =>
      new Date(anchorMs - (anchor.epoch - e) * EPOCH_LEN_MS).toISOString();

    // For each gap (prevSnap, nextSnap), pre-compute the per-epoch
    // distributed pool growth + per-epoch carrier values.
    interface GapInfo {
      perEpochPoolMon: number;
      stakeMon: number;
      selfStakeMon: number;
      commissionPct: number;
      unclaimedAtPrev: number;
    }
    const gapInfo = new Map<number, GapInfo>(); // key = epoch within gap
    for (let i = 1; i < orderedSnaps.length; i++) {
      const prev = orderedSnaps[i - 1];
      const next = orderedSnaps[i];
      const prevUnclaimed = toMon(BigInt(prev.unclaimedRewards));
      const nextUnclaimed = toMon(BigInt(next.unclaimedRewards));
      // Sum claims with epoch in (prev.epoch, next.epoch].
      let claimsInGapWei = BigInt(0);
      for (const [ce, cw] of allClaimsByEpoch.entries()) {
        if (ce > prev.epoch && ce <= next.epoch) claimsInGapWei += cw;
      }
      const claimsInGapMon = toMon(claimsInGapWei);
      const gapSpan = next.epoch - prev.epoch;
      const totalPoolGapMon = Math.max(
        0,
        nextUnclaimed - prevUnclaimed + claimsInGapMon
      );
      const perEpoch = gapSpan > 0 ? totalPoolGapMon / gapSpan : 0;
      const stakeMon = toMon(BigInt(prev.stakeWei));
      const selfStakeMon = prev.selfStakeWei
        ? toMon(BigInt(prev.selfStakeWei))
        : 0;
      const commissionPct = (Number(BigInt(prev.commission)) / 1e18) * 100;
      // Apply to every epoch (prev.epoch, next.epoch], capped to window.
      for (let e = prev.epoch + 1; e <= next.epoch; e++) {
        if (e < windowFromEpoch || e > windowToEpoch) continue;
        gapInfo.set(e, {
          perEpochPoolMon: perEpoch,
          stakeMon,
          selfStakeMon,
          commissionPct,
          unclaimedAtPrev: prevUnclaimed,
        });
      }
    }
    // If the very first window epoch has no preceding snapshot, still
    // emit a row using the first snapshot's carrier values (no pool growth
    // because we have no baseline to subtract from).
    if (!baseline && inWindow.length > 0) {
      const first = inWindow[0];
      if (first.epoch >= windowFromEpoch && !gapInfo.has(first.epoch)) {
        gapInfo.set(first.epoch, {
          perEpochPoolMon: 0,
          stakeMon: toMon(BigInt(first.stakeWei)),
          selfStakeMon: first.selfStakeWei
            ? toMon(BigInt(first.selfStakeWei))
            : 0,
          commissionPct: (Number(BigInt(first.commission)) / 1e18) * 100,
          unclaimedAtPrev: toMon(BigInt(first.unclaimedRewards)),
        });
      }
    }

    for (let epoch = windowFromEpoch; epoch <= windowToEpoch; epoch++) {
      // Skip epochs we don't have any data for (entirely outside snapshot range).
      const gi = gapInfo.get(epoch);
      if (!gi) continue;

      const epochClaims = claimsByEpoch.get(epoch);
      const claimedMon = epochClaims ? toMon(epochClaims.totalWei) : 0;
      const pf = pfMap.get(epoch);
      const priorityFeesMon = pf?.feesMon ?? 0;
      const priorityFeeBlocks = pf?.blocks ?? 0;
      const fxPrice = fxFor(epoch);
      const priorityFeesUsd = priorityFeesMon * fxPrice;

      epochsArray.push({
        epoch,
        timestamp: epochTimestamp(epoch),
        stakeMon: gi.stakeMon,
        selfStakeMon: gi.selfStakeMon,
        commissionPct: gi.commissionPct,
        unclaimedMon: gi.unclaimedAtPrev,
        poolEarnedMon: gi.perEpochPoolMon,
        validatorShareMon: 0, // backfilled in second pass
        claimedMon,
        priorityFeesMon,
        priorityFeeBlocks,
        fxPriceUsd: fxPrice,
        validatorShareUsd: 0,
        priorityFeesUsd,
        commissionMon: 0,
        commissionUsd: 0,
      });

      summaryClaimedMon += claimedMon;
      summaryPriorityFeesMon += priorityFeesMon;
      summaryPriorityFeesUsd += priorityFeesUsd;
    }

    // ── Fill in gap epochs (priority fees indexed, no snapshot coverage) ──
    // For epochs with priority fees but outside the snapshot range
    // entirely (e.g. before the earliest snapshot), emit a row with
    // estimated timestamp and zero pool earned.
    const seenEpochs = new Set(epochsArray.map((r) => r.epoch));
    for (const [epoch, pf] of pfMap.entries()) {
      if (seenEpochs.has(epoch)) continue;
      if (epoch < windowFromEpoch || epoch > windowToEpoch) continue;
      const epochClaims = claimsByEpoch.get(epoch);
      const claimedMon = epochClaims ? toMon(epochClaims.totalWei) : 0;
      const fxPrice = fxFor(epoch);
      const priorityFeesUsd = pf.feesMon * fxPrice;
      epochsArray.push({
        epoch,
        timestamp: epochTimestamp(epoch),
        stakeMon: 0,
        selfStakeMon: 0,
        commissionPct: meta.commissionPct ? Number(meta.commissionPct) : 0,
        unclaimedMon: 0,
        poolEarnedMon: 0,
        validatorShareMon: 0,
        claimedMon,
        priorityFeesMon: pf.feesMon,
        priorityFeeBlocks: pf.blocks,
        fxPriceUsd: fxPrice,
        validatorShareUsd: 0,
        priorityFeesUsd,
        commissionMon: 0,
        commissionUsd: 0,
      });
      summaryClaimedMon += claimedMon;
      summaryPriorityFeesMon += pf.feesMon;
      summaryPriorityFeesUsd += priorityFeesUsd;
    }
    // Re-sort epochsArray by epoch ascending so table is in order.
    epochsArray.sort((a, b) => a.epoch - b.epoch);

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
    // ── Empirical share derivation ──────────────────────────────────
    //
    // The validator's share of every epoch's pool growth is a property of
    // their commission rate + self-stake position — NOT of the window
    // the user picked. So derive the empirical share from LIFETIME data
    // (all claims + lifetime pool growth), then apply that scalar to the
    // current windowed per-epoch pool earnings.
    //
    // Without this, picking a 3-day window with no claims in it gives
    // share = pendingShare/windowPool ≈ 4%, dramatically undercounting
    // the validator's actual income for that window.

    // Sum lifetime auth-address claims, bounded to AFTER the first snapshot
    // we have. The pool reconstruction below only spans our snapshot range,
    // so we have to bound claims to the same range or the empirical share
    // ratio comes out lopsided (claims older than our snapshot floor would
    // be in the numerator but not the denominator).
    const firstSnapEpoch = allSnaps[0].epoch;
    const lifetimeClaimsAggRaw = await db
      .select({
        totalWei: sql<string>`COALESCE(SUM(${claimEvents.amountWei}), 0)::text`,
      })
      .from(claimEvents)
      .where(
        and(
          eq(claimEvents.validatorId, validatorId),
          eq(claimEvents.delegator, auth),
          gte(claimEvents.epoch, firstSnapEpoch)
        )
      );
    const lifetimeClaimedMon = toMon(
      BigInt(lifetimeClaimsAggRaw[0]?.totalWei || "0")
    );

    // Reconstruct lifetime pool earned across ALL snapshots, not just
    // windowed ones. Same formula: Δ(unclaimed) + claims-in-that-epoch.
    // Bound to claims AT OR AFTER the first snapshot — claims that
    // happened before our snapshot history is in scope shouldn't be
    // added back to a pool delta we can't observe.
    const allClaimsLifetimeRaw = await db
      .select({
        epoch: claimEvents.epoch,
        amountWei: claimEvents.amountWei,
      })
      .from(claimEvents)
      .where(
        and(
          eq(claimEvents.validatorId, validatorId),
          gte(claimEvents.epoch, firstSnapEpoch)
        )
      );
    const allClaimsByEpochLifetime = new Map<number, bigint>();
    for (const c of allClaimsLifetimeRaw) {
      const wei = BigInt(c.amountWei);
      allClaimsByEpochLifetime.set(
        c.epoch,
        (allClaimsByEpochLifetime.get(c.epoch) ?? BigInt(0)) + wei
      );
    }
    // Sort claims-by-epoch for range summing. Snapshots are taken once per
    // day (and missed days exist), so claim epochs almost never line up with
    // snapshot epochs. We need to sum ALL claims that fell in
    // (prevSnap.epoch, currSnap.epoch] — every claim drained the pool
    // regardless of whether our cron happened to snapshot that exact epoch.
    const sortedClaimEpochs = Array.from(
      allClaimsByEpochLifetime.entries()
    ).sort((a, b) => a[0] - b[0]);
    let claimIdx = 0;
    let lifetimePoolEarnedMon = 0;
    let prevLifetimeUnclaimed = toMon(BigInt(allSnaps[0].unclaimedRewards));
    let prevLifetimeEpoch = allSnaps[0].epoch;
    for (let i = 1; i < allSnaps.length; i++) {
      const s = allSnaps[i];
      const curr = toMon(BigInt(s.unclaimedRewards));
      // Sum every claim wei whose epoch falls in (prevLifetimeEpoch, s.epoch].
      let claimWei = BigInt(0);
      while (
        claimIdx < sortedClaimEpochs.length &&
        sortedClaimEpochs[claimIdx][0] <= s.epoch
      ) {
        if (sortedClaimEpochs[claimIdx][0] > prevLifetimeEpoch) {
          claimWei += sortedClaimEpochs[claimIdx][1];
        }
        claimIdx++;
      }
      const claimedMon = toMon(claimWei);
      const raw = curr - prevLifetimeUnclaimed + claimedMon;
      if (raw > 0) lifetimePoolEarnedMon += raw;
      prevLifetimeUnclaimed = curr;
      prevLifetimeEpoch = s.epoch;
    }

    // Pro-rata pending share at lifetime view (uses last snapshot ever).
    const lastEverSnap = allSnaps[allSnaps.length - 1];
    const lastEverStakeWei = BigInt(lastEverSnap.stakeWei);
    const lastEverSelfWei = lastEverSnap.selfStakeWei
      ? BigInt(lastEverSnap.selfStakeWei)
      : BigInt(0);
    const lastEverUnclaimed = toMon(BigInt(lastEverSnap.unclaimedRewards));
    const lastEverCommissionRate =
      Number(BigInt(lastEverSnap.commission)) / 1e18;
    const lastEverSelfFraction =
      lastEverStakeWei > BigInt(0) && lastEverSelfWei > BigInt(0)
        ? Number(lastEverSelfWei) / Number(lastEverStakeWei)
        : 0;
    const lifetimePendingShareMon =
      lastEverUnclaimed * lastEverCommissionRate +
      lastEverUnclaimed * (1 - lastEverCommissionRate) * lastEverSelfFraction;

    const lifetimeAuthEarnedMon =
      lifetimeClaimedMon + lifetimePendingShareMon;

    // Empirical share = (lifetime claims + lifetime pendingShare) /
    // lifetime pool earned. This scalar is stable across windows.
    const empiricalShare =
      lifetimePoolEarnedMon > 0
        ? lifetimeAuthEarnedMon / lifetimePoolEarnedMon
        : 0;

    // Window-scoped totals for the summary card (windowed pool × scalar).
    let totalPoolEarnedMon = 0;
    for (const r of epochsArray) totalPoolEarnedMon += r.poolEarnedMon;
    const proRataPendingShare = lifetimePendingShareMon; // for compat below
    const totalAuthEarnedMon = summaryClaimedMon + proRataPendingShare;
    let summaryCommissionMon = 0;
    let summaryCommissionUsd = 0;
    for (const r of epochsArray) {
      r.validatorShareMon = r.poolEarnedMon * empiricalShare;
      r.validatorShareUsd = r.validatorShareMon * r.fxPriceUsd;
      // Update legacy aliases.
      r.commissionMon = r.validatorShareMon;
      r.commissionUsd = r.validatorShareUsd;
      summaryCommissionMon += r.validatorShareMon;
      summaryCommissionUsd += r.validatorShareUsd;
    }

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
      // shMonad MEV/priority-fee payouts (SendValidatorRewards events).
      // mevValidatorPayoutMon = MON that flowed into the validator's stake
      //   pool via STAKING.externalReward — already counted inside the
      //   pool's claim_events stream once delegators claim, so this is
      //   informational visibility, NOT added to totalIncome.
      // mevFeeTakenMon = shMonad protocol revenue (does NOT reach the
      //   validator).
      // mevTotalCapturedMon = total MEV captured before the protocol fee.
      mevValidatorPayoutMon: mevSummary.validatorPayoutMon,
      mevValidatorPayoutUsd: mevSummary.validatorPayoutMon * livePrice,
      mevFeeTakenMon: mevSummary.feeTakenMon,
      mevFeeTakenUsd: mevSummary.feeTakenMon * livePrice,
      mevTotalCapturedMon:
        mevSummary.validatorPayoutMon + mevSummary.feeTakenMon,
      mevTotalCapturedUsd:
        (mevSummary.validatorPayoutMon + mevSummary.feeTakenMon) * livePrice,
      mevEventCount: mevSummary.eventCount,
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
