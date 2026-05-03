"use client";

/**
 * Validator detail page — the dashboard for a single validator.
 *
 * Self-contained income reporting: date range, FX toggle (live vs per-epoch),
 * inline CSV/PDF export. No need to go to /reports for any of it.
 *
 * Data source: /api/v1/validators/[id]/realized-report which uses the
 * unclaimed_rewards delta + claim detection algorithm. Matches CFO ground
 * truth at <0.1%.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  FileDown,
  Printer,
  Calendar,
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

interface ReportEpoch {
  epoch: number;
  timestamp: string;
  stakeMon: number;
  commissionPct: number;
  unclaimedMon: number;
  commissionMon: number;
  claimedMon: number;
  priorityFeesMon: number;
  priorityFeeBlocks: number;
  fxPriceUsd: number;
  commissionUsd: number;
  priorityFeesUsd: number;
}

interface ReportSummary {
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
  fxMethodology: "per-epoch" | "end-of-period";
  endOfPeriodPriceUsd: number;
  livePriceUsd: number;
}

interface ReportResp {
  validatorId: number;
  validator: {
    name: string;
    authAddress: string;
    stakeMon: number;
    commissionPct: number;
  };
  window: {
    fromEpoch: number;
    toEpoch: number;
    epochSpan: number;
    daysObserved: number;
    firstTimestamp: string | null;
    lastTimestamp: string | null;
  };
  summary: ReportSummary;
  epochs: ReportEpoch[];
  claimEvents: Array<{ epoch: number; amountMon: number; timestamp: string }>;
}

function fmtMon(n: number, dp = 2): string {
  if (!isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(dp)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(dp)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: dp });
}

function fmtUsd(n: number): string {
  if (!n || !isFinite(n) || n === 0) return "$0";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtDays(d: number): string {
  if (!isFinite(d) || d <= 0) return "—";
  if (d < 1) return `${(d * 24).toFixed(1)} hrs`;
  if (d < 30) return `${d.toFixed(1)} days`;
  if (d < 365) return `${(d / 30).toFixed(1)} months`;
  return `${(d / 365).toFixed(2)} years`;
}

// Quick presets — friendlier than always typing dates manually.
const PRESETS = [
  { label: "All time", days: null },
  { label: "Last 7d", days: 7 },
  { label: "Last 30d", days: 30 },
  { label: "Last 90d", days: 90 },
];

export default function ValidatorPage() {
  const params = useParams();
  const validatorId = params?.id as string;

  // Filter state
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [fx, setFx] = useState<"per-epoch" | "end-of-period">("per-epoch");
  const [serverCostUsd, setServerCostUsd] = useState<number>(0);

  // Data state
  const [data, setData] = useState<ReportResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Build query string for both fetch and CSV download
  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("fx", fx);
    if (serverCostUsd > 0) p.set("serverCostUsd", String(serverCostUsd));
    if (fromDate) p.set("fromDate", new Date(fromDate).toISOString());
    if (toDate) {
      // Make toDate inclusive — set to end of day
      const t = new Date(toDate);
      t.setHours(23, 59, 59, 999);
      p.set("toDate", t.toISOString());
    }
    return p.toString();
  }, [fx, serverCostUsd, fromDate, toDate]);

  const fetchReport = useCallback(async () => {
    if (!validatorId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/v1/validators/${validatorId}/realized-report?${queryString}`
      );
      const json = await res.json();
      if (json.error) {
        setErr(json.error);
        setData(null);
      } else {
        setData(json);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [validatorId, queryString]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  function applyPreset(days: number | null) {
    if (days == null) {
      setFromDate("");
      setToDate("");
      return;
    }
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setFromDate(from.toISOString().slice(0, 10));
    setToDate(to.toISOString().slice(0, 10));
  }

  function downloadCsv() {
    const url = `/api/v1/validators/${validatorId}/realized-report?${queryString}&format=csv`;
    window.open(url, "_blank");
  }

  function printPdf() {
    window.print();
  }

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.epochs
      .slice(-90)
      .map((e) => ({
        epoch: e.epoch,
        commission: e.commissionMon,
        priorityFees: e.priorityFeesMon,
      }));
  }, [data]);

  return (
    <div className="relative z-[1] min-h-screen px-6 pt-8 pb-6 print:bg-white print:text-black print:p-8">
      <div className="print:hidden">
        <AuroraBg />
        <FloatingParticles />
      </div>

      <div className="max-w-[1200px] mx-auto">
        {/* Back link */}
        <Link
          href="/"
          className="print:hidden inline-flex items-center gap-1.5 text-cream-40 text-xs font-body hover:text-phase-green transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </Link>

        {loading && !data ? (
          <div className="text-center py-20 text-cream-40 text-sm font-body animate-pulse">
            Loading validator data…
          </div>
        ) : err ? (
          <div className="text-center py-20 text-cream-60 text-sm font-body">
            <div className="font-medium mb-2">Couldn&apos;t load this validator</div>
            <div className="text-cream-40 text-xs">{err}</div>
          </div>
        ) : data ? (
          <>
            {/* Header */}
            <header className="mb-8 pb-6 border-b border-cream-8 print:border-black/20">
              <div className="flex items-baseline gap-3 mb-1 flex-wrap">
                <h1 className="font-display text-3xl text-cream tracking-[0.02em] print:text-black">
                  {data.validator.name}
                </h1>
                <span className="text-cream-40 text-xs font-mono px-2 py-0.5 rounded border border-cream-12 print:text-black/60 print:border-black/30">
                  #{data.validatorId}
                </span>
              </div>
              <a
                href={`https://monadexplorer.com/address/${data.validator.authAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-cream-40 hover:text-phase-green text-xs font-mono transition-colors print:text-black/60"
              >
                {data.validator.authAddress}
                <ExternalLink className="w-3 h-3" />
              </a>
            </header>

            {/* CONTROLS — date range, FX, server cost, export buttons */}
            <section className="print:hidden mb-6 rounded-xl border border-cream-12 bg-cream-5 p-5">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Date range */}
                <div className="lg:col-span-2">
                  <label className="block text-[10px] font-body uppercase tracking-widest text-cream-40 mb-2">
                    <Calendar className="inline w-3 h-3 mr-1" />
                    Date range
                  </label>
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="flex-1 rounded-md border border-cream-12 bg-dark px-2.5 py-1.5 text-xs font-body text-cream focus:border-phase-green/40 focus:outline-none [color-scheme:dark]"
                    />
                    <span className="text-cream-40 text-xs">→</span>
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className="flex-1 rounded-md border border-cream-12 bg-dark px-2.5 py-1.5 text-xs font-body text-cream focus:border-phase-green/40 focus:outline-none [color-scheme:dark]"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {PRESETS.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => applyPreset(p.days)}
                        className="text-[10px] font-body text-cream-40 hover:text-cream bg-cream-5 hover:bg-cream-8 border border-cream-12 px-2 py-0.5 rounded transition-colors"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* FX methodology */}
                <div>
                  <label className="block text-[10px] font-body uppercase tracking-widest text-cream-40 mb-2">
                    USD pricing
                  </label>
                  <div className="flex rounded-md border border-cream-12 overflow-hidden">
                    <button
                      onClick={() => setFx("per-epoch")}
                      className={`flex-1 text-[11px] font-body py-1.5 transition-colors ${
                        fx === "per-epoch"
                          ? "bg-phase-green/15 text-phase-green"
                          : "text-cream-40 hover:text-cream hover:bg-cream-5"
                      }`}
                    >
                      Historical
                    </button>
                    <button
                      onClick={() => setFx("end-of-period")}
                      className={`flex-1 text-[11px] font-body py-1.5 border-l border-cream-12 transition-colors ${
                        fx === "end-of-period"
                          ? "bg-phase-green/15 text-phase-green"
                          : "text-cream-40 hover:text-cream hover:bg-cream-5"
                      }`}
                    >
                      Current price
                    </button>
                  </div>
                  <p className="text-[10px] text-cream-40 mt-1.5 leading-snug">
                    {fx === "per-epoch"
                      ? "Each epoch valued at the MON price at that time."
                      : "All MON valued at the latest live price."}
                  </p>
                </div>

                {/* Server cost */}
                <div>
                  <label className="block text-[10px] font-body uppercase tracking-widest text-cream-40 mb-2">
                    Monthly server cost
                  </label>
                  <div className="flex items-center gap-1 rounded-md border border-cream-12 bg-dark px-2.5 py-1.5">
                    <span className="text-cream-40 text-xs">$</span>
                    <input
                      type="number"
                      min={0}
                      value={serverCostUsd}
                      onChange={(e) =>
                        setServerCostUsd(Math.max(0, Number(e.target.value) || 0))
                      }
                      placeholder="0"
                      className="flex-1 bg-transparent text-cream text-xs font-body outline-none w-full"
                    />
                    <span className="text-cream-40 text-[10px]">/mo</span>
                  </div>
                  <p className="text-[10px] text-cream-40 mt-1.5 leading-snug">
                    Pro-rated against the window for net income.
                  </p>
                </div>
              </div>

              {/* Export row */}
              <div className="mt-5 pt-4 border-t border-cream-8 flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-body uppercase tracking-widest text-cream-40 mr-2">
                  Export
                </span>
                <button
                  onClick={downloadCsv}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-body text-phase-green bg-phase-green/10 border border-phase-green/30 rounded-md hover:bg-phase-green/15 transition-all"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  Download CSV
                </button>
                <button
                  onClick={printPdf}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-body text-cream-60 bg-cream-5 hover:bg-cream-8 border border-cream-12 rounded-md transition-all"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print / Save PDF
                </button>
                {data.window.daysObserved > 0 && (
                  <span className="ml-auto text-[10px] font-body text-cream-40">
                    Window: epoch {data.window.fromEpoch} → {data.window.toEpoch}
                    {" · "}
                    {fmtDays(data.window.daysObserved)}
                  </span>
                )}
              </div>
            </section>

            {/* HEADLINE — total income for the selected window */}
            <section className="mb-6 rounded-2xl border border-cream-12 bg-cream-5 p-6 print:bg-white print:border-black/20">
              <div className="flex items-baseline justify-between gap-4 flex-wrap mb-1">
                <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 print:text-black/60">
                  Total income · realized commission + priority fees
                </div>
                <div className="text-[10px] font-body text-cream-40 print:text-black/60">
                  {fx === "per-epoch" ? "Historical pricing" : `@ live $${data.summary.livePriceUsd.toFixed(4)}/MON`}
                </div>
              </div>
              <div className="flex items-baseline gap-4 flex-wrap">
                <div className="font-mono text-cream text-5xl tracking-tight print:text-black">
                  {fmtMon(data.summary.totalIncomeMon, 2)}
                  <span className="text-cream-60 text-3xl ml-2 print:text-black/60">MON</span>
                </div>
                <div className="font-mono text-phase-green text-2xl">
                  {fmtUsd(data.summary.totalIncomeUsd)}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-cream-8 print:border-black/20">
                <div>
                  <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 print:text-black/60">
                    Commission
                  </div>
                  <div className="font-mono text-cream text-base mt-0.5 print:text-black">
                    {fmtMon(data.summary.commissionMon)} MON
                  </div>
                  <div className="font-mono text-cream-40 text-xs mt-0.5">
                    {fmtUsd(data.summary.commissionUsd)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 print:text-black/60">
                    Priority fees
                  </div>
                  <div className="font-mono text-cream text-base mt-0.5 print:text-black">
                    {fmtMon(data.summary.priorityFeesMon)} MON
                  </div>
                  <div className="font-mono text-cream-40 text-xs mt-0.5">
                    {fmtUsd(data.summary.priorityFeesUsd)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 print:text-black/60">
                    Server cost
                  </div>
                  <div className="font-mono text-cream text-base mt-0.5 print:text-black">
                    −{fmtUsd(data.summary.serverCostProRatedUsd)}
                  </div>
                  <div className="font-mono text-cream-40 text-xs mt-0.5">
                    {fmtUsd(data.summary.serverCostMonthlyUsd)}/mo
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 print:text-black/60">
                    Net (USD)
                  </div>
                  <div className="font-mono text-phase-green text-base mt-0.5">
                    {fmtUsd(data.summary.netUsd)}
                  </div>
                  <div className="font-mono text-cream-40 text-xs mt-0.5">
                    after costs
                  </div>
                </div>
              </div>
            </section>

            {/* Claimed vs Unclaimed split */}
            <section className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-cream-12 bg-cream-5 p-5 print:bg-white print:border-black/20">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-phase-green" />
                  <span className="text-[10px] font-body uppercase tracking-widest text-cream-40 print:text-black/60">
                    Claimed (lifetime, all-time)
                  </span>
                </div>
                <div className="font-mono text-cream text-2xl print:text-black">
                  {fmtMon(data.summary.claimedMon)} <span className="text-cream-60 text-lg print:text-black/60">MON</span>
                </div>
                <div className="text-cream-40 text-xs font-body mt-1">
                  {data.claimEvents.length} claim event{data.claimEvents.length === 1 ? "" : "s"}
                </div>
              </div>
              <div className="rounded-xl border border-cream-12 bg-cream-5 p-5 print:bg-white print:border-black/20">
                <div className="flex items-center gap-2 mb-2">
                  <Hourglass className="w-4 h-4 text-phase-yellow" />
                  <span className="text-[10px] font-body uppercase tracking-widest text-cream-40 print:text-black/60">
                    Unclaimed (sitting in contract)
                  </span>
                </div>
                <div className="font-mono text-cream text-2xl print:text-black">
                  {fmtMon(data.summary.unclaimedMon)} <span className="text-cream-60 text-lg print:text-black/60">MON</span>
                </div>
                <div className="text-cream-40 text-xs font-body mt-1">
                  Claimable any time
                </div>
              </div>
            </section>

            {/* Income chart */}
            {chartData.length > 1 && (
              <section className="mb-6 rounded-xl border border-cream-12 bg-cream-5 p-5 print:bg-white print:border-black/20">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-display text-base text-cream tracking-wide print:text-black">
                    Per-epoch income (MON)
                  </h2>
                  <span className="text-[10px] font-body text-cream-40 print:text-black/60">
                    Last {chartData.length} epochs
                  </span>
                </div>
                <div className="h-64 print:h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(243,238,217,0.06)" />
                      <XAxis
                        dataKey="epoch"
                        stroke="rgba(243,238,217,0.4)"
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis stroke="rgba(243,238,217,0.4)" tick={{ fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{
                          background: "#161513",
                          border: "1px solid rgba(243,238,217,0.12)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        labelStyle={{ color: "rgba(243,238,217,0.6)" }}
                      />
                      <Bar dataKey="commission" name="Commission" fill="#4ade80" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="priorityFees" name="Priority fees" fill="#facc15" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {/* Per-epoch breakdown table */}
            <section className="mb-6 rounded-xl border border-cream-12 bg-cream-5 overflow-hidden print:bg-white print:border-black/20">
              <div className="flex items-center justify-between p-4 border-b border-cream-8 print:border-black/20">
                <h2 className="font-display text-base text-cream tracking-wide print:text-black">
                  Per-epoch breakdown
                </h2>
                <span className="text-[10px] font-body text-cream-40 print:text-black/60">
                  {data.epochs.length} epochs
                </span>
              </div>
              <div className="overflow-x-auto max-h-[480px]">
                <table className="w-full text-xs font-mono">
                  <thead className="sticky top-0 bg-cream-5 print:bg-white">
                    <tr className="border-b border-cream-8 print:border-black/20">
                      <th className="text-left px-4 py-2 text-cream-40 font-body font-normal print:text-black/60">Epoch</th>
                      <th className="text-left px-4 py-2 text-cream-40 font-body font-normal print:text-black/60">Date</th>
                      <th className="text-right px-4 py-2 text-cream-40 font-body font-normal print:text-black/60">Comm.%</th>
                      <th className="text-right px-4 py-2 text-cream-40 font-body font-normal print:text-black/60">Comm. MON</th>
                      <th className="text-right px-4 py-2 text-cream-40 font-body font-normal print:text-black/60">Pri. Fees MON</th>
                      <th className="text-right px-4 py-2 text-cream-40 font-body font-normal print:text-black/60">FX $/MON</th>
                      <th className="text-right px-4 py-2 text-cream-40 font-body font-normal print:text-black/60">Total USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.epochs].reverse().map((e) => {
                      const totalUsd = e.commissionUsd + e.priorityFeesUsd;
                      const claimed = e.claimedMon > 0;
                      return (
                        <tr
                          key={e.epoch}
                          className="border-b border-cream-8 hover:bg-cream-5 transition-colors print:border-black/10"
                        >
                          <td className="px-4 py-1.5 text-cream print:text-black">{e.epoch}</td>
                          <td className="px-4 py-1.5 text-cream-60 print:text-black/70">
                            {new Date(e.timestamp).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-1.5 text-right text-cream-60 print:text-black/70">
                            {e.commissionPct.toFixed(0)}%
                          </td>
                          <td className="px-4 py-1.5 text-right text-cream print:text-black">
                            {e.commissionMon.toFixed(2)}
                            {claimed && (
                              <span title={`Claim: ${e.claimedMon.toFixed(2)} MON`} className="ml-1 text-phase-green">
                                ✓
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-1.5 text-right text-cream-60 print:text-black/70">
                            {e.priorityFeesMon > 0 ? e.priorityFeesMon.toFixed(2) : "—"}
                          </td>
                          <td className="px-4 py-1.5 text-right text-cream-40 print:text-black/60">
                            ${e.fxPriceUsd.toFixed(4)}
                          </td>
                          <td className="px-4 py-1.5 text-right text-cream font-medium print:text-black">
                            ${totalUsd.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 border-t border-cream-8 text-[10px] font-body text-cream-40 print:border-black/20 print:text-black/60">
                ✓ = claim event detected this epoch (validator pulled MON out of the contract)
              </div>
            </section>

            {/* Claim history */}
            {data.claimEvents.length > 0 && (
              <section className="mb-6 rounded-xl border border-cream-12 bg-cream-5 p-5 print:bg-white print:border-black/20">
                <h2 className="font-display text-base text-cream tracking-wide mb-3 print:text-black">
                  Claim history
                </h2>
                <div className="space-y-1.5">
                  {[...data.claimEvents].reverse().map((c) => (
                    <div
                      key={c.epoch}
                      className="flex items-center justify-between text-xs font-body py-1.5 border-b border-cream-8 last:border-0 print:border-black/10"
                    >
                      <span className="text-cream-60 print:text-black/70">
                        Epoch {c.epoch} · {new Date(c.timestamp).toLocaleDateString()}
                      </span>
                      <span className="font-mono text-cream print:text-black">
                        {c.amountMon.toFixed(2)} MON
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Footer note for printed version */}
            <div className="hidden print:block mt-8 pt-4 border-t border-black/20 text-xs text-black/60 font-body">
              Generated from monad-income-tracker.vercel.app · Data sourced directly from
              Monad staking precompile via unclaimed_rewards delta + claim detection.
              FX methodology: {fx === "per-epoch" ? "per-epoch historical pricing" : `end-of-period @ $${data.summary.livePriceUsd.toFixed(4)}/MON`}.
            </div>
          </>
        ) : null}
      </div>

      <div className="print:hidden">
        <Footer />
      </div>
    </div>
  );
}
