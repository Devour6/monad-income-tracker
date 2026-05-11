"use client";

/**
 * Validator detail page — full dashboard for a single validator, mobile-friendly.
 *
 * Same chrome as home (top bar with title + nav links). Inline controls:
 * date range, FX toggle (live vs per-epoch), CSV download, print-to-PDF.
 *
 * Data: /api/v1/validators/[id]/realized-report — uses the unclaimed_rewards
 * delta + claim detection algorithm (matches CFO ground truth at <0.1%).
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ExternalLink,
  FileDown,
  Printer,
  CheckCircle2,
  Hourglass,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";

interface Report {
  validatorId: number;
  validator: {
    name: string | null;
    authAddress: string;
    stakeMon: number;
    commissionPct: number;
    lastEpoch: number | null;
  };
  window: {
    fromEpoch: number;
    toEpoch: number;
    epochSpan: number;
    daysObserved: number;
    firstTimestamp: string | null;
    lastTimestamp: string | null;
  };
  summary: {
    commissionMon: number;
    commissionUsd: number;
    priorityFeesMon: number;
    priorityFeesUsd: number;
    totalIncomeMon: number;
    totalIncomeUsd: number;
    claimedMon: number;
    unclaimedMon: number;
    serverCostMonthlyUsd: number;
    serverCostProRatedUsd: number;
    netUsd: number;
    // shMonad MEV (informational — overlaps with claim_events, not added to totalIncome)
    mevValidatorPayoutMon?: number;
    mevValidatorPayoutUsd?: number;
    mevFeeTakenMon?: number;
    mevFeeTakenUsd?: number;
    mevTotalCapturedMon?: number;
    mevTotalCapturedUsd?: number;
    mevEventCount?: number;
    fxMethodology: "per-epoch" | "end-of-period";
    endOfPeriodPriceUsd: number;
    livePriceUsd: number;
    isFullWindow: boolean;
  };
  epochs: Array<{
    epoch: number;
    timestamp: string;
    stakeMon: number;
    selfStakeMon: number;
    commissionPct: number;
    unclaimedMon: number;
    // Pool-wide reward earned on-chain this epoch (commission + delegator).
    poolEarnedMon: number;
    // Validator's pro-rata slice of poolEarnedMon.
    validatorShareMon: number;
    validatorShareUsd: number;
    claimedMon: number;
    priorityFeesMon: number;
    priorityFeeBlocks: number;
    fxPriceUsd: number;
    priorityFeesUsd: number;
    // Legacy aliases (= validatorShareMon / validatorShareUsd).
    commissionMon: number;
    commissionUsd: number;
  }>;
  claimEvents: Array<{
    epoch: number;
    timestamp: string;
    amountMon: number;
    amountUsd?: number;
    txHash?: string;
  }>;
}

function fmtMon(n: number, dp = 2): string {
  if (!isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(dp);
}

function fmtMonExact(n: number): string {
  if (!isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function fmtUsd(n: number): string {
  if (!isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

const PRESETS: Array<{ label: string; days: number | "all" }> = [
  { label: "All time", days: "all" },
  { label: "Last 7d", days: 7 },
  { label: "Last 30d", days: 30 },
  { label: "Last 90d", days: 90 },
];

export default function ValidatorDashboard() {
  const params = useParams();
  const validatorId = params?.id as string;

  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [fx, setFx] = useState<"per-epoch" | "end-of-period">("per-epoch");
  const [serverCostUsd, setServerCostUsd] = useState<number>(0);

  // Validate a YYYY-MM-DD string. Native <input type="date"> can hand us
  // partial / impossible values (e.g. "0202-05-28" mid-typing, or "2026-02-31")
  // — gate fetches and URL building on a real Date.
  function parseValidDate(s: string): Date | null {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (y < 2024 || y > 2100) return null;
    if (mo < 1 || mo > 12) return null;
    if (d < 1 || d > 31) return null;
    const dt = new Date(`${s}T00:00:00.000Z`);
    if (isNaN(dt.getTime())) return null;
    // Round-trip check catches things like Feb 31 → Mar 3.
    if (dt.toISOString().slice(0, 10) !== s) return null;
    return dt;
  }

  const fromDateValid = parseValidDate(fromDate);
  const toDateValid = parseValidDate(toDate);
  // Both blank = "All time". Either set without the other = also acceptable
  // (the API treats the missing side as snapshot bound). Both set with
  // from > to is invalid.
  const dateRangeValid =
    !(fromDate && !fromDateValid) &&
    !(toDate && !toDateValid) &&
    !(fromDateValid && toDateValid && fromDateValid > toDateValid);

  const buildUrl = useCallback(
    (format: "json" | "csv") => {
      const p = new URLSearchParams();
      p.set("format", format);
      p.set("fx", fx);
      p.set("serverCostUsd", String(serverCostUsd || 0));
      if (fromDateValid) p.set("fromDate", fromDateValid.toISOString());
      if (toDateValid) {
        const end = new Date(toDateValid);
        end.setUTCHours(23, 59, 59, 999);
        p.set("toDate", end.toISOString());
      }
      return `/api/v1/validators/${validatorId}/realized-report?${p.toString()}`;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      validatorId,
      fx,
      serverCostUsd,
      fromDateValid?.getTime(),
      toDateValid?.getTime(),
    ]
  );

  const load = useCallback(async () => {
    if (!validatorId) return;
    if (!dateRangeValid) return; // wait for the user to finish typing
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(buildUrl("json"));
      const j = await r.json();
      if (j.error) {
        setErr(j.error);
        setData(null);
      } else {
        setData(j);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [validatorId, buildUrl, dateRangeValid]);

  // Debounce — wait 350ms of stillness before refetching. Prevents firing
  // on every keystroke while the user is editing the date inputs.
  useEffect(() => {
    const t = setTimeout(() => {
      load();
    }, 350);
    return () => clearTimeout(t);
  }, [load]);

  function applyPreset(days: number | "all") {
    if (days === "all") {
      setFromDate("");
      setToDate("");
      return;
    }
    const to = new Date();
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    setFromDate(from.toISOString().slice(0, 10));
    setToDate(to.toISOString().slice(0, 10));
  }

  function downloadCsv() {
    window.open(buildUrl("csv"), "_blank");
  }

  function printPdf() {
    if (typeof window !== "undefined") window.print();
  }

  const chartData = useMemo(() => {
    if (!data) return [];
    // Plot validator's pro-rata share of pool earnings + priority fees
    // per epoch. Both are direct from on-chain state — no projection.
    return data.epochs.slice(-90).map((e) => ({
      epoch: e.epoch,
      yourShare: e.validatorShareMon,
      priorityFees: e.priorityFeesMon,
    }));
  }, [data]);

  const presetLabel = useMemo(() => {
    if (!fromDate && !toDate) return "All time";
    if (fromDateValid && toDateValid) {
      const days = Math.round(
        (toDateValid.getTime() - fromDateValid.getTime()) /
          (1000 * 60 * 60 * 24)
      );
      const match = PRESETS.find((p) => p.days === days);
      return match?.label ?? `Custom (${days}d)`;
    }
    return "Custom";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, fromDateValid?.getTime(), toDateValid?.getTime()]);

  return (
    <div className="relative z-[1] min-h-screen px-4 sm:px-6 pt-8 sm:pt-10 pb-6 print:bg-white print:text-black print:p-8">
      <div className="print:hidden">
        <AuroraBg />
        <FloatingParticles />
      </div>

      <div className="max-w-[1100px] mx-auto">
        {/* Top bar — same as home, mobile collapses nav under title */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-8 sm:mb-12 opacity-0 animate-fade-in-up print:hidden">
          <Link href="/" className="flex items-center gap-3">
            <h1 className="font-display text-lg sm:text-xl text-cream tracking-[0.04em]">
              Monad Income Tracker
            </h1>
          </Link>
          <nav className="flex items-center gap-1 -mx-1 sm:mx-0">
            {[
              { href: "/methodology", label: "Methodology" },
              { href: "/sdk", label: "API" },
              { href: "/docs", label: "Docs" },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-xs font-body text-cream-40 hover:text-cream transition-colors px-3 py-1.5 rounded-md hover:bg-cream-5"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </header>

        {/* Validator header */}
        <header className="mb-6 sm:mb-8 pb-5 sm:pb-6 border-b border-cream-8 print:border-black/20">
          <div className="flex items-baseline gap-2 sm:gap-3 mb-1 flex-wrap">
            <h2 className="font-display text-2xl sm:text-3xl text-cream tracking-[0.02em] print:text-black">
              {data?.validator?.name || `Validator #${validatorId}`}
            </h2>
            <span className="text-cream-40 text-xs font-mono px-2 py-0.5 rounded border border-cream-12 print:text-black/60 print:border-black/30">
              #{validatorId}
            </span>
          </div>
          {data?.validator?.authAddress && (
            <a
              href={`https://monadexplorer.com/address/${data.validator.authAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-cream-40 hover:text-phase-green text-[11px] sm:text-xs font-mono transition-colors print:text-black/60 break-all"
            >
              <span className="break-all">{data.validator.authAddress}</span>
              <ExternalLink className="w-3 h-3 print:hidden shrink-0" />
            </a>
          )}
        </header>

        {/* CONTROLS — always visible. Single column on mobile. */}
        <section className="mb-6 rounded-xl border border-cream-12 bg-cream-5 p-4 sm:p-5 print:hidden">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
            {/* Date range */}
            <div>
              <label className="block text-[10px] font-body uppercase tracking-widest text-cream-40 mb-2">
                Date range
              </label>
              <div className="flex gap-1.5 mb-2 flex-wrap">
                {PRESETS.map((p) => {
                  const active = presetLabel === p.label;
                  return (
                    <button
                      key={p.label}
                      onClick={() => applyPreset(p.days)}
                      className={`text-[11px] font-body px-2 py-0.5 rounded border transition-colors ${
                        active
                          ? "text-phase-green bg-phase-green/10 border-phase-green/40"
                          : "text-cream-40 hover:text-cream bg-cream-5 hover:bg-cream-8 border-cream-12"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 items-center">
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className={`flex-1 min-w-0 rounded-md border bg-dark px-2.5 py-1.5 text-xs font-body text-cream focus:outline-none [color-scheme:dark] ${
                    fromDate && !fromDateValid
                      ? "border-phase-yellow/50"
                      : "border-cream-12 focus:border-phase-green/40"
                  }`}
                />
                <span className="text-cream-40 text-xs font-body">→</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className={`flex-1 min-w-0 rounded-md border bg-dark px-2.5 py-1.5 text-xs font-body text-cream focus:outline-none [color-scheme:dark] ${
                    toDate && !toDateValid
                      ? "border-phase-yellow/50"
                      : "border-cream-12 focus:border-phase-green/40"
                  }`}
                />
              </div>
              {!dateRangeValid && (fromDate || toDate) ? (
                <div className="mt-1.5 text-[10px] font-body text-phase-yellow">
                  {fromDate && !fromDateValid
                    ? "From date isn't valid yet — keep typing."
                    : toDate && !toDateValid
                      ? "To date isn't valid yet — keep typing."
                      : "From date is after to date."}
                </div>
              ) : null}
            </div>

            {/* FX toggle */}
            <div>
              <label className="block text-[10px] font-body uppercase tracking-widest text-cream-40 mb-2">
                Price methodology
              </label>
              <div className="flex rounded-md border border-cream-12 overflow-hidden">
                <button
                  onClick={() => setFx("per-epoch")}
                  className={`flex-1 text-[11px] font-body py-1.5 transition-colors ${
                    fx === "per-epoch"
                      ? "bg-phase-green/10 text-phase-green"
                      : "bg-cream-5 text-cream-40 hover:text-cream hover:bg-cream-8"
                  }`}
                >
                  Historical
                </button>
                <button
                  onClick={() => setFx("end-of-period")}
                  className={`flex-1 text-[11px] font-body py-1.5 border-l border-cream-12 transition-colors ${
                    fx === "end-of-period"
                      ? "bg-phase-green/10 text-phase-green"
                      : "bg-cream-5 text-cream-40 hover:text-cream hover:bg-cream-8"
                  }`}
                >
                  Current
                </button>
              </div>
              <div className="text-[10px] font-body text-cream-40 mt-1.5">
                {fx === "per-epoch"
                  ? "Each epoch valued at MON price at that time"
                  : `All MON valued at $${
                      data?.summary?.livePriceUsd?.toFixed(4) ?? "—"
                    }`}
              </div>
            </div>

            {/* Server cost */}
            <div>
              <label className="block text-[10px] font-body uppercase tracking-widest text-cream-40 mb-2">
                Server cost ($/month)
              </label>
              <div className="flex items-center gap-2 rounded-md border border-cream-12 bg-dark px-2.5 py-1.5">
                <span className="text-cream-40 text-xs font-body">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={1}
                  value={serverCostUsd || ""}
                  onChange={(e) =>
                    setServerCostUsd(Math.max(0, Number(e.target.value) || 0))
                  }
                  placeholder="0"
                  className="flex-1 bg-transparent text-cream text-xs font-body outline-none w-full min-w-0"
                />
              </div>
              <div className="text-[10px] font-body text-cream-40 mt-1.5">
                Pro-rated against window for net USD
              </div>
            </div>
          </div>

          {/* Actions — wrap on mobile */}
          <div className="mt-5 pt-4 border-t border-cream-12 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-body uppercase tracking-widest text-cream-40 mr-1">
              Export
            </span>
            <button
              onClick={downloadCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-body text-phase-green bg-phase-green/10 border border-phase-green/30 rounded-md hover:bg-phase-green/15 transition-all"
            >
              <FileDown className="w-3.5 h-3.5" />
              CSV
            </button>
            <button
              onClick={printPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-body text-cream-60 bg-cream-5 hover:bg-cream-8 border border-cream-12 rounded-md transition-all"
            >
              <Printer className="w-3.5 h-3.5" />
              PDF
            </button>
            {data && (
              <span className="basis-full sm:basis-auto sm:ml-auto text-[10px] font-body text-cream-40">
                {data.window.epochSpan} epochs · {data.window.daysObserved.toFixed(1)} days
              </span>
            )}
          </div>
        </section>

        {loading && !data ? (
          <div className="text-center py-16 sm:py-20 text-cream-40 text-sm font-body animate-pulse">
            Loading validator data…
          </div>
        ) : err ? (
          <div className="text-center py-16 sm:py-20 text-cream-60 text-sm font-body">
            <div className="font-medium mb-2">Couldn&apos;t load this validator</div>
            <div className="text-cream-40 text-xs">{err}</div>
          </div>
        ) : data ? (
          <>
            {/* Headline tiles — earned per epoch is the truth (on-chain pool
                growth × validator pro-rata, summed over the window). Claimed
                is shown as a sub-stat: how much of that has been withdrawn. */}
            <section className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <div
                className="rounded-xl border border-phase-green/30 bg-phase-green/5 p-4 sm:p-5"
                title="Sum of per-epoch on-chain pool growth × your auth address's pro-rata share, plus priority fees. Earned regardless of whether you've claimed."
              >
                <div className="text-[10px] font-body uppercase tracking-widest text-phase-green mb-1.5 inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-phase-green" />
                  {data.summary.isFullWindow
                    ? "Lifetime earned"
                    : `Earned in window${
                        data.window?.daysObserved
                          ? ` (${data.window.daysObserved.toFixed(1)}d)`
                          : ""
                      }`}
                </div>
                <div className="font-display text-2xl sm:text-3xl text-cream tracking-wide print:text-black">
                  {fmtMon(data.summary.totalIncomeMon)}
                  <span className="text-cream-40 text-base font-body ml-1.5">MON</span>
                </div>
                <div className="font-mono text-cream-60 text-sm mt-1">
                  {fmtUsd(data.summary.totalIncomeUsd)}
                  {serverCostUsd > 0 && (
                    <span className="text-cream-40 ml-2">
                      · net {fmtUsd(data.summary.netUsd)}
                    </span>
                  )}
                </div>
                <div className="font-mono text-cream-40 text-[11px] mt-0.5">
                  {data.summary.isFullWindow ? (
                    <>
                      {fmtMon(data.summary.claimedMon)} MON withdrawn ·{" "}
                      {data.claimEvents.length} claim
                      {data.claimEvents.length === 1 ? "" : "s"}
                    </>
                  ) : (
                    <>
                      {fmtMon(data.summary.claimedMon)} MON withdrawn in window
                      {data.claimEvents.length > 0
                        ? ` · ${data.claimEvents.length} claim${
                            data.claimEvents.length === 1 ? "" : "s"
                          }`
                        : ""}
                    </>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-cream-12 bg-cream-5 p-4 sm:p-5">
                <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 mb-1.5 inline-flex items-center gap-1.5">
                  <ExternalLink className="w-3 h-3 text-cream-40" />
                  Priority fees
                </div>
                <div className="font-display text-xl sm:text-2xl text-cream tracking-wide print:text-black">
                  {fmtMon(data.summary.priorityFeesMon)}
                  <span className="text-cream-40 text-sm font-body ml-1.5">MON</span>
                </div>
                <div className="font-mono text-cream-60 text-sm mt-1">
                  {fmtUsd(data.summary.priorityFeesUsd)}
                </div>
                <div className="font-mono text-cream-40 text-[11px] mt-0.5">
                  Direct to validator wallet
                </div>
              </div>
              {(() => {
                // Estimate the validator's share of the pending pool:
                //   commission × poolUnclaimed
                //   + (1 - commission) × (selfStake / totalStake) × poolUnclaimed
                // Rest belongs to other delegators. Latest epoch row supplies
                // the freshest selfStake/totalStake split.
                const lastEpochRow = data.epochs[data.epochs.length - 1];
                const totalStake = lastEpochRow?.stakeMon || data.validator.stakeMon || 0;
                const selfStake = lastEpochRow?.selfStakeMon || 0;
                const commRate = (data.validator.commissionPct || 0) / 100;
                const selfFrac = totalStake > 0 ? selfStake / totalStake : 0;
                const yourShareOfPool =
                  data.summary.unclaimedMon * commRate +
                  data.summary.unclaimedMon * (1 - commRate) * selfFrac;
                const delegatorsShare = data.summary.unclaimedMon - yourShareOfPool;
                return (
                  <div
                    className="rounded-xl border border-cream-12 bg-cream-5 p-4 sm:p-5"
                    title={`Pool pending splits into ~${commRate * 100}% commission + ${(selfFrac * 100).toFixed(2)}% of remainder (your self-stake share). Rest belongs to other delegators and won't reach your wallet.`}
                  >
                    <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 mb-1.5 inline-flex items-center gap-1.5">
                      <Hourglass className="w-3 h-3 text-phase-yellow" />
                      Your pending share
                    </div>
                    <div className="font-display text-xl sm:text-2xl text-cream tracking-wide print:text-black">
                      {fmtMon(yourShareOfPool)}
                      <span className="text-cream-40 text-sm font-body ml-1.5">MON</span>
                    </div>
                    <div className="font-mono text-cream-60 text-sm mt-1">
                      {fmtUsd(yourShareOfPool * data.summary.livePriceUsd)}
                    </div>
                    <div className="font-mono text-cream-40 text-[11px] mt-0.5">
                      of {fmtMon(data.summary.unclaimedMon)} MON pool pending ·{" "}
                      {fmtMon(delegatorsShare)} owed to delegators
                    </div>
                  </div>
                );
              })()}
            </section>

            {/* shMonad MEV strip — only show if this validator is enrolled
                (mevTotalCapturedMon > 0). Otherwise hide the whole section
                to avoid showing zeros to non-shMonad validators. */}
            {(data.summary.mevTotalCapturedMon || 0) > 0 && (
              <section className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                <div
                  className="rounded-xl border border-phase-yellow/30 bg-phase-yellow/5 p-4 sm:p-5"
                  title="Total MEV + priority fees captured by your shMonad Coinbase contract in this window. Indexed from SendValidatorRewards events on the shMonad proxy (0x1b68...e19c)."
                >
                  <div className="text-[10px] font-body uppercase tracking-widest text-phase-yellow mb-1.5">
                    MEV captured
                  </div>
                  <div className="font-display text-xl sm:text-2xl text-cream tracking-wide print:text-black">
                    {fmtMon(data.summary.mevTotalCapturedMon || 0)}
                    <span className="text-cream-40 text-sm font-body ml-1.5">MON</span>
                  </div>
                  <div className="font-mono text-cream-60 text-sm mt-1">
                    {fmtUsd(data.summary.mevTotalCapturedUsd || 0)}
                  </div>
                  <div className="font-mono text-cream-40 text-[11px] mt-0.5">
                    {data.summary.mevEventCount || 0} payout events
                  </div>
                </div>
                <div className="rounded-xl border border-cream-12 bg-cream-5 p-4 sm:p-5">
                  <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 mb-1.5">
                    → Pool inflow
                  </div>
                  <div className="font-display text-xl sm:text-2xl text-cream tracking-wide print:text-black">
                    {fmtMon(data.summary.mevValidatorPayoutMon || 0)}
                    <span className="text-cream-40 text-sm font-body ml-1.5">MON</span>
                  </div>
                  <div className="font-mono text-cream-60 text-sm mt-1">
                    {fmtUsd(data.summary.mevValidatorPayoutUsd || 0)}
                  </div>
                  <div className="font-mono text-cream-40 text-[11px] mt-0.5">
                    Distributed to delegators on next claim
                  </div>
                </div>
                <div className="rounded-xl border border-cream-12 bg-cream-5 p-4 sm:p-5">
                  <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 mb-1.5">
                    shMonad protocol fee
                  </div>
                  <div className="font-display text-xl sm:text-2xl text-cream tracking-wide print:text-black">
                    {fmtMon(data.summary.mevFeeTakenMon || 0)}
                    <span className="text-cream-40 text-sm font-body ml-1.5">MON</span>
                  </div>
                  <div className="font-mono text-cream-60 text-sm mt-1">
                    {fmtUsd(data.summary.mevFeeTakenUsd || 0)}
                  </div>
                  <div className="font-mono text-cream-40 text-[11px] mt-0.5">
                    Boost commission to shMON holders
                  </div>
                </div>
              </section>
            )}

            {/* Vitals row — 2 cols on mobile, 4 on tablet+ */}
            <section className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              <div className="rounded-lg border border-cream-8 bg-cream-5 p-3">
                <div className="text-[10px] font-body uppercase tracking-widest text-cream-40">
                  Stake
                </div>
                <div className="font-mono text-cream text-sm mt-1 truncate">
                  {fmtMon(data.validator.stakeMon)} MON
                </div>
              </div>
              <div className="rounded-lg border border-cream-8 bg-cream-5 p-3">
                <div className="text-[10px] font-body uppercase tracking-widest text-cream-40">
                  Commission
                </div>
                <div className="font-mono text-cream text-sm mt-1">
                  {data.validator.commissionPct}%
                </div>
              </div>
              <div className="rounded-lg border border-cream-8 bg-cream-5 p-3">
                <div className="text-[10px] font-body uppercase tracking-widest text-cream-40">
                  Priority fees
                </div>
                <div className="font-mono text-cream text-sm mt-1 truncate">
                  {fmtMon(data.summary.priorityFeesMon)} MON
                </div>
              </div>
              <div className="rounded-lg border border-cream-8 bg-cream-5 p-3">
                <div className="text-[10px] font-body uppercase tracking-widest text-cream-40">
                  Latest epoch
                </div>
                <div className="font-mono text-cream text-sm mt-1">
                  {data.validator.lastEpoch ?? "—"}
                </div>
              </div>
            </section>

            {/* Chart — shorter on mobile */}
            {chartData.length > 0 && (
              <section className="mb-6 rounded-xl border border-cream-12 bg-cream-5 p-4 sm:p-5 print:hidden">
                <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 mb-3">
                  Per-epoch income (last {chartData.length} epochs)
                </div>
                <ResponsiveContainer width="100%" height={180} className="sm:!h-[220px]">
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(243, 238, 217, 0.08)" />
                    <XAxis
                      dataKey="epoch"
                      tick={{ fontSize: 9, fill: "rgba(243, 238, 217, 0.4)" }}
                      stroke="rgba(243, 238, 217, 0.12)"
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: "rgba(243, 238, 217, 0.4)" }}
                      stroke="rgba(243, 238, 217, 0.12)"
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#161513",
                        border: "1px solid rgba(243, 238, 217, 0.12)",
                        borderRadius: 8,
                        fontSize: 11,
                      }}
                      labelStyle={{ color: "rgba(243, 238, 217, 0.6)" }}
                    />
                    <Bar dataKey="yourShare" fill="#4ade80" name="Your share" />
                    <Bar dataKey="priorityFees" fill="#facc15" name="Priority fees" />
                  </BarChart>
                </ResponsiveContainer>
              </section>
            )}

            {/* Per-epoch table — horizontally scrollable on mobile.
                Date column hidden on mobile to keep it scannable. */}
            <section className="mb-6 rounded-xl border border-cream-12 bg-cream-5 overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-cream-12 flex items-center justify-between">
                <div className="text-[10px] font-body uppercase tracking-widest text-cream-40">
                  Per-epoch breakdown
                </div>
                <div className="text-[10px] font-body text-cream-40">
                  {data.epochs.length} epochs
                </div>
              </div>
              <div className="px-4 sm:px-5 py-2 border-b border-cream-12 bg-cream-5/50 text-[10px] font-body text-cream-40 leading-relaxed">
                <strong className="text-cream-60">Pool earned</strong> = the
                whole stake pool&apos;s on-chain reward growth that epoch
                (commission + delegator share, derived from the precompile&apos;s
                unclaimed_rewards delta + claim events). <strong className="text-cream-60">Your share</strong>{" "}
                = pro-rata slice your auth address owns based on self-stake.
                Both numbers are direct from on-chain state — earned regardless
                of claims.
              </div>
              <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                <table className="w-full text-xs font-body min-w-[760px]">
                  <thead className="bg-cream-5 sticky top-0 z-10">
                    <tr className="text-cream-40 text-[10px] uppercase tracking-widest">
                      <th className="text-left px-3 sm:px-4 py-2 font-body">Epoch</th>
                      <th className="hidden sm:table-cell text-left px-4 py-2 font-body">Date</th>
                      <th className="text-right px-3 sm:px-4 py-2 font-body">Stake</th>
                      <th className="text-right px-3 sm:px-4 py-2 font-body">Pool earned</th>
                      <th className="text-right px-3 sm:px-4 py-2 font-body">Your share</th>
                      <th className="hidden sm:table-cell text-right px-4 py-2 font-body">Pri Fees</th>
                      <th className="hidden sm:table-cell text-right px-4 py-2 font-body">$/MON</th>
                      <th className="text-right px-3 sm:px-4 py-2 font-body">USD</th>
                      <th className="text-center px-2 sm:px-3 py-2 font-body">Claim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.epochs
                      .slice()
                      .reverse()
                      .map((e, i) => (
                        <tr
                          key={e.epoch}
                          className={`border-t border-cream-8 ${
                            i % 2 === 0 ? "bg-transparent" : "bg-cream-5/40"
                          }`}
                        >
                          <td className="px-3 sm:px-4 py-2 text-cream font-mono">{e.epoch}</td>
                          <td className="hidden sm:table-cell px-4 py-2 text-cream-60">
                            {fmtDateShort(e.timestamp)}
                          </td>
                          <td className="px-3 sm:px-4 py-2 text-right text-cream-60 font-mono">
                            {fmtMon(e.stakeMon)}
                          </td>
                          <td className="px-3 sm:px-4 py-2 text-right text-cream-60 font-mono">
                            {e.poolEarnedMon > 0
                              ? fmtMonExact(e.poolEarnedMon)
                              : "—"}
                          </td>
                          <td className="px-3 sm:px-4 py-2 text-right text-cream font-mono">
                            {e.validatorShareMon > 0
                              ? fmtMonExact(e.validatorShareMon)
                              : "—"}
                          </td>
                          <td className="hidden sm:table-cell px-4 py-2 text-right text-cream-60 font-mono">
                            {e.priorityFeesMon > 0
                              ? fmtMonExact(e.priorityFeesMon)
                              : "—"}
                          </td>
                          <td className="hidden sm:table-cell px-4 py-2 text-right text-cream-40 font-mono">
                            ${e.fxPriceUsd.toFixed(4)}
                          </td>
                          <td className="px-3 sm:px-4 py-2 text-right text-cream font-mono">
                            {fmtUsd(e.validatorShareUsd + e.priorityFeesUsd)}
                          </td>
                          <td className="px-2 sm:px-3 py-2 text-center">
                            {e.claimedMon > 0 ? (
                              <span
                                className="inline-flex items-center justify-center text-phase-green"
                                title={`Claimed ${fmtMonExact(e.claimedMon)} MON`}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </span>
                            ) : (
                              <span className="text-cream-20">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Claim history */}
            {data.claimEvents.length > 0 && (
              <section className="mb-6 rounded-xl border border-cream-12 bg-cream-5 overflow-hidden">
                <div className="px-4 sm:px-5 py-3 border-b border-cream-12">
                  <div className="text-[10px] font-body uppercase tracking-widest text-cream-40">
                    Claim history
                  </div>
                </div>
                <div className="divide-y divide-cream-8">
                  {[...data.claimEvents].reverse().map((c, i) => {
                    const tx = c.txHash;
                    return (
                      <div
                        key={`${c.epoch}-${tx ?? i}`}
                        className="px-4 sm:px-5 py-2.5 flex items-center justify-between gap-2 text-xs font-body"
                      >
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                          <CheckCircle2 className="w-3.5 h-3.5 text-phase-green shrink-0" />
                          <span className="text-cream-60">epoch {c.epoch}</span>
                          <span className="text-cream-40 truncate">
                            {fmtDate(c.timestamp)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-cream font-mono">
                            {fmtMonExact(c.amountMon)} MON
                          </span>
                          {tx && (
                            <a
                              href={`https://monadexplorer.com/tx/${tx}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-cream-40 hover:text-phase-green transition-colors"
                              title="View transaction on Monad explorer"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        ) : null}

        <Footer />
      </div>
    </div>
  );
}
