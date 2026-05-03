"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileDown, FileText, Printer } from "lucide-react";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";

interface ValidatorListItem {
  validatorId: number;
  name: string;
  authAddress: string;
  stakeMon: number;
  commissionPct: number;
  lastEpoch: number;
}

interface EpochRow {
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

interface Summary {
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
    validatorId: number;
    name: string;
    authAddress: string;
    commissionPct: number;
    stakeMon: number;
  } | null;
  window: {
    fromEpoch: number;
    toEpoch: number;
    epochSpan: number;
    daysObserved: number;
    firstTimestamp: string;
    lastTimestamp: string;
  } | null;
  summary: Summary | null;
  epochs: EpochRow[];
  claimEvents: Array<{
    epoch: number;
    timestamp: string;
    amountMon: number;
    amountUsd: number;
  }>;
}

const fmtMon = (n: number | null | undefined, dp = 2) =>
  n == null
    ? "—"
    : n.toLocaleString(undefined, {
        maximumFractionDigits: dp,
        minimumFractionDigits: dp,
      });
const fmtUsd = (n: number | null | undefined, dp = 2) =>
  n == null
    ? "—"
    : `$${n.toLocaleString(undefined, {
        maximumFractionDigits: dp,
        minimumFractionDigits: dp,
      })}`;

export default function ReportsPage() {
  const [validators, setValidators] = useState<ValidatorListItem[]>([]);
  const [validatorId, setValidatorId] = useState<number | null>(null);
  const [vQuery, setVQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [fx, setFx] = useState<"per-epoch" | "end-of-period">("per-epoch");
  const [serverCostUsd, setServerCostUsd] = useState<number>(0);
  const [data, setData] = useState<ReportResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/validators")
      .then((r) => r.json())
      .then((d) => setValidators(d.validators || []))
      .catch(() => {});
  }, []);

  const filteredValidators = useMemo(() => {
    if (!vQuery.trim()) return validators.slice(0, 30);
    const q = vQuery.trim().toLowerCase();
    return validators
      .filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.authAddress.toLowerCase().includes(q) ||
          String(v.validatorId).includes(q)
      )
      .slice(0, 30);
  }, [validators, vQuery]);

  const buildQuery = (format: "json" | "csv") => {
    if (validatorId == null) return null;
    const params = new URLSearchParams();
    params.set("fx", fx);
    params.set("serverCostUsd", String(serverCostUsd || 0));
    params.set("format", format);
    if (fromDate) params.set("fromDate", new Date(fromDate).toISOString());
    if (toDate) params.set("toDate", new Date(toDate).toISOString());
    return `/api/v1/validators/${validatorId}/realized-report?${params.toString()}`;
  };

  const runReport = async () => {
    const url = buildQuery("json");
    if (!url) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(url);
      const d = await r.json();
      if (d.error) setErr(d.error);
      else setData(d);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  // Auto-run when validator picked
  useEffect(() => {
    if (validatorId != null) runReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validatorId, fx, fromDate, toDate, serverCostUsd]);

  const downloadCsv = () => {
    const url = buildQuery("csv");
    if (url) window.open(url, "_blank");
  };

  const printPdf = () => {
    if (typeof window !== "undefined") window.print();
  };

  const selectedValidator = useMemo(
    () => validators.find((v) => v.validatorId === validatorId) ?? null,
    [validators, validatorId]
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-dark print:bg-white">
      <div className="print:hidden">
        <AuroraBg />
        <FloatingParticles />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl px-6 py-12 print:max-w-none print:px-0 print:py-0 print:text-black">
        <div className="print:hidden">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-1.5 text-xs font-body text-cream-40 transition-all hover:text-cream-60"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Link>

          <header className="mb-8">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cream-8 bg-cream-5 px-3 py-1">
              <FileText className="h-3.5 w-3.5 text-phase-green" />
              <span className="text-[10px] font-body uppercase tracking-widest text-cream-40">
                Realized income report
              </span>
            </div>
            <h1 className="font-display text-3xl text-cream tracking-wide">
              Validator income reports
            </h1>
            <p className="mt-3 text-sm font-body text-cream-60 leading-relaxed max-w-3xl">
              Treasury-grade exports using realized commission math
              (unclaimed-rewards delta + claim detection — verified to 0.04%
              against CFO records). Includes priority fees, claim events, and
              FX-converted USD totals. Export to CSV or print to PDF.
            </p>
          </header>

          {/* Controls */}
          <section className="mb-8 rounded-xl border border-cream-8 bg-cream-5 p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-[10px] font-body uppercase tracking-widest text-cream-40">
                  Validator
                </label>
                <input
                  value={vQuery}
                  onChange={(e) => setVQuery(e.target.value)}
                  placeholder="Search by name, address, or ID"
                  className="w-full rounded-lg border border-cream-8 bg-dark px-3 py-2 text-sm font-body text-cream placeholder:text-cream-40 focus:border-cream-20 focus:outline-none"
                />
                {vQuery && filteredValidators.length > 0 && (
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-cream-8 bg-dark">
                    {filteredValidators.map((v) => (
                      <button
                        key={v.validatorId}
                        onClick={() => {
                          setValidatorId(v.validatorId);
                          setVQuery(v.name);
                        }}
                        className={`block w-full px-3 py-2 text-left text-xs font-body transition-colors hover:bg-cream-5 ${
                          validatorId === v.validatorId
                            ? "bg-cream-8 text-cream"
                            : "text-cream-60"
                        }`}
                      >
                        <div className="font-medium text-cream">{v.name}</div>
                        <div className="text-[10px] text-cream-40">
                          #{v.validatorId} · {v.commissionPct}% comm ·{" "}
                          {Math.round(v.stakeMon).toLocaleString()} MON
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {selectedValidator && (
                  <div className="mt-2 text-[11px] font-body text-cream-60">
                    Selected:{" "}
                    <span className="text-cream">{selectedValidator.name}</span>{" "}
                    (#{selectedValidator.validatorId})
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-body uppercase tracking-widest text-cream-40">
                    From date
                  </label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="w-full rounded-lg border border-cream-8 bg-dark px-3 py-2 text-sm font-body text-cream focus:border-cream-20 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-body uppercase tracking-widest text-cream-40">
                    To date
                  </label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="w-full rounded-lg border border-cream-8 bg-dark px-3 py-2 text-sm font-body text-cream focus:border-cream-20 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-body uppercase tracking-widest text-cream-40">
                  FX methodology
                </label>
                <div className="flex gap-2">
                  {(["per-epoch", "end-of-period"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setFx(m)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-xs font-body transition-colors ${
                        fx === m
                          ? "border-phase-green/40 bg-phase-green/10 text-cream"
                          : "border-cream-8 bg-dark text-cream-60 hover:bg-cream-5"
                      }`}
                    >
                      {m === "per-epoch" ? "Per-epoch FX" : "End-of-period FX"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-body uppercase tracking-widest text-cream-40">
                  Monthly server cost (USD)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={serverCostUsd || ""}
                  onChange={(e) =>
                    setServerCostUsd(Math.max(0, Number(e.target.value) || 0))
                  }
                  placeholder="0"
                  className="w-full rounded-lg border border-cream-8 bg-dark px-3 py-2 text-sm font-body text-cream placeholder:text-cream-40 focus:border-cream-20 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={runReport}
                disabled={validatorId == null || loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-phase-green/40 bg-phase-green/10 px-4 py-2 text-xs font-body text-cream transition-colors hover:bg-phase-green/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? "Loading…" : "Run report"}
              </button>
              <button
                onClick={downloadCsv}
                disabled={validatorId == null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cream-8 bg-cream-5 px-4 py-2 text-xs font-body text-cream-60 transition-colors hover:bg-cream-8 hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FileDown className="h-3.5 w-3.5" /> Export CSV
              </button>
              <button
                onClick={printPdf}
                disabled={!data}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cream-8 bg-cream-5 px-4 py-2 text-xs font-body text-cream-60 transition-colors hover:bg-cream-8 hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Printer className="h-3.5 w-3.5" /> Print / PDF
              </button>
            </div>

            {err && (
              <div className="mt-4 rounded-lg border border-phase-red/30 bg-phase-red/10 px-3 py-2 text-xs font-body text-phase-red">
                {err}
              </div>
            )}
          </section>
        </div>

        {/* Report body */}
        {data && data.summary && data.window && data.validator && (
          <article className="space-y-6 print:text-black">
            {/* Print header */}
            <div className="hidden print:block">
              <h1 className="font-display text-2xl">
                Monad Validator Income Report
              </h1>
              <p className="text-sm">
                {data.validator.name} · #{data.validator.validatorId}
              </p>
              <p className="text-xs">{data.validator.authAddress}</p>
              <hr className="my-3" />
            </div>

            {/* Headline */}
            <section className="rounded-2xl border border-cream-12 bg-cream-5 p-6 print:border-black print:bg-white">
              <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 print:text-black">
                Total income · {data.window.daysObserved.toFixed(1)} days
                observed
              </div>
              <div className="mt-1 font-display text-4xl text-cream tracking-wide print:text-black">
                {fmtMon(data.summary.totalIncomeMon)} MON
              </div>
              <div className="mt-1 font-mono text-sm text-cream-60 print:text-black">
                ≈ {fmtUsd(data.summary.totalIncomeUsd)}
              </div>
              <div className="mt-3 text-[11px] font-body text-cream-40 print:text-black">
                {data.validator.name} · #{data.validator.validatorId} · epochs{" "}
                {data.window.fromEpoch}–{data.window.toEpoch}
              </div>
            </section>

            {/* Stat tiles */}
            <section className="grid grid-cols-1 gap-4 md:grid-cols-3 print:grid-cols-3">
              <Tile
                label="Commission earned"
                mon={data.summary.commissionMon}
                usd={data.summary.commissionUsd}
              />
              <Tile
                label="Priority fees"
                mon={data.summary.priorityFeesMon}
                usd={data.summary.priorityFeesUsd}
              />
              <Tile
                label="Net (after server cost)"
                usd={data.summary.netUsd}
              />
            </section>

            {/* Claimed vs unclaimed split */}
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 print:grid-cols-2">
              <Tile
                label="Already claimed"
                mon={data.summary.claimedMon}
                usd={data.summary.claimedMon * (data.summary.livePriceUsd || 0)}
                tone="muted"
              />
              <Tile
                label="Unclaimed (in contract)"
                mon={data.summary.unclaimedMon}
                usd={
                  data.summary.unclaimedMon * (data.summary.livePriceUsd || 0)
                }
                tone="muted"
              />
            </section>

            {/* Window meta */}
            <section className="rounded-xl border border-cream-8 bg-cream-5 p-5 text-xs font-body text-cream-60 print:border-black print:bg-white print:text-black">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-cream-40 print:text-black">
                    First epoch
                  </div>
                  <div className="font-mono text-cream print:text-black">
                    {data.window.fromEpoch}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-cream-40 print:text-black">
                    Last epoch
                  </div>
                  <div className="font-mono text-cream print:text-black">
                    {data.window.toEpoch}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-cream-40 print:text-black">
                    Days
                  </div>
                  <div className="font-mono text-cream print:text-black">
                    {data.window.daysObserved.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-cream-40 print:text-black">
                    FX methodology
                  </div>
                  <div className="font-mono text-cream print:text-black">
                    {data.summary.fxMethodology}
                  </div>
                </div>
              </div>
              {data.summary.serverCostMonthlyUsd > 0 && (
                <div className="mt-3 border-t border-cream-8 pt-3">
                  Server cost: {fmtUsd(data.summary.serverCostMonthlyUsd)}/mo ·
                  prorated {fmtUsd(data.summary.serverCostProRatedUsd)} over{" "}
                  {data.window.daysObserved.toFixed(1)} days
                </div>
              )}
            </section>

            {/* Claim events */}
            {data.claimEvents.length > 0 && (
              <section className="rounded-xl border border-cream-8 bg-cream-5 p-5 print:border-black print:bg-white">
                <h3 className="font-display text-sm uppercase tracking-widest text-cream-40 mb-3 print:text-black">
                  Claim events ({data.claimEvents.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-body">
                    <thead>
                      <tr className="text-left text-cream-40 border-b border-cream-8 print:text-black">
                        <th className="pb-2 pr-4">Epoch</th>
                        <th className="pb-2 pr-4">Date</th>
                        <th className="pb-2 pr-4 text-right">MON</th>
                        <th className="pb-2 text-right">USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.claimEvents.map((c) => (
                        <tr
                          key={c.epoch}
                          className="border-b border-cream-8 last:border-0 text-cream-60 print:text-black"
                        >
                          <td className="py-2 pr-4 font-mono">{c.epoch}</td>
                          <td className="py-2 pr-4">
                            {new Date(c.timestamp).toLocaleDateString()}
                          </td>
                          <td className="py-2 pr-4 text-right font-mono text-cream print:text-black">
                            {fmtMon(c.amountMon)}
                          </td>
                          <td className="py-2 text-right font-mono">
                            {fmtUsd(c.amountUsd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Per-epoch breakdown */}
            <section className="rounded-xl border border-cream-8 bg-cream-5 p-5 print:border-black print:bg-white">
              <h3 className="font-display text-sm uppercase tracking-widest text-cream-40 mb-3 print:text-black">
                Per-epoch breakdown ({data.epochs.length} epochs)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-body">
                  <thead>
                    <tr className="text-left text-cream-40 border-b border-cream-8 print:text-black">
                      <th className="pb-2 pr-3">Epoch</th>
                      <th className="pb-2 pr-3">Date</th>
                      <th className="pb-2 pr-3 text-right">Stake</th>
                      <th className="pb-2 pr-3 text-right">Comm.</th>
                      <th className="pb-2 pr-3 text-right">Comm. MON</th>
                      <th className="pb-2 pr-3 text-right">PF MON</th>
                      <th className="pb-2 pr-3 text-right">FX</th>
                      <th className="pb-2 text-right">USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.epochs.map((e) => (
                      <tr
                        key={e.epoch}
                        className="border-b border-cream-8 last:border-0 text-cream-60 print:text-black"
                      >
                        <td className="py-1.5 pr-3 font-mono">{e.epoch}</td>
                        <td className="py-1.5 pr-3">
                          {new Date(e.timestamp).toLocaleDateString()}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono">
                          {Math.round(e.stakeMon).toLocaleString()}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono">
                          {e.commissionPct.toFixed(0)}%
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono text-cream print:text-black">
                          {fmtMon(e.commissionMon, 4)}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono">
                          {fmtMon(e.priorityFeesMon, 4)}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono">
                          {e.fxPriceUsd > 0 ? `$${e.fxPriceUsd.toFixed(4)}` : "—"}
                        </td>
                        <td className="py-1.5 text-right font-mono">
                          {fmtUsd(e.commissionUsd + e.priorityFeesUsd, 4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </article>
        )}

        {!data && validatorId != null && !loading && !err && (
          <div className="text-center py-12 text-cream-40 text-sm font-body">
            Loading report…
          </div>
        )}
        {!validatorId && (
          <div className="text-center py-12 text-cream-40 text-sm font-body print:hidden">
            Pick a validator to generate a report.
          </div>
        )}
      </div>

      <div className="print:hidden">
        <Footer />
      </div>
    </div>
  );
}

function Tile({
  label,
  mon,
  usd,
  tone,
}: {
  label: string;
  mon?: number;
  usd?: number;
  tone?: "muted";
}) {
  return (
    <div
      className={`rounded-xl border p-5 ${
        tone === "muted"
          ? "border-cream-8 bg-cream-5"
          : "border-cream-12 bg-cream-5"
      } print:border-black print:bg-white`}
    >
      <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 print:text-black">
        {label}
      </div>
      {mon != null && (
        <div className="mt-1 font-mono text-xl text-cream print:text-black">
          {mon.toLocaleString(undefined, {
            maximumFractionDigits: 2,
            minimumFractionDigits: 2,
          })}{" "}
          <span className="text-xs text-cream-40 print:text-black">MON</span>
        </div>
      )}
      {usd != null && (
        <div
          className={`${mon != null ? "mt-0.5 text-xs" : "mt-1 text-xl font-mono"} text-cream-60 print:text-black`}
        >
          {usd.toLocaleString(undefined, {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 2,
          })}
        </div>
      )}
    </div>
  );
}
