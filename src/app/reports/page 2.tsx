"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileDown, FileText, Calculator, Info } from "lucide-react";
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

interface ReportRow {
  epoch: number;
  epochSpan: number;
  timestamp: string;
  stakeMon: number;
  selfStakeMon: number | null;
  commissionPct: number;
  poolRewardsMon: number;
  commissionMon: number;
  delegatorRewardsMon: number;
  selfStakeRewardsMon: number;
  priorityFeesMon: number;
  priorityFeeBlocks: number;
  validatorTotalMon: number;
  fxPriceUsd: number;
  poolRewardsUsd: number;
  commissionUsd: number;
  priorityFeesUsd: number;
  validatorTotalUsd: number;
}

interface ReportSummary {
  epochCount: number;
  epochSpan: number;
  observedDays: number;
  firstEpoch: number | null;
  lastEpoch: number | null;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  poolRewardsMon: number;
  commissionMon: number;
  delegatorRewardsMon: number;
  selfStakeRewardsMon: number | null;
  priorityFeesMon: number | null;
  validatorTotalMon: number | null;
  poolRewardsUsd: number;
  commissionUsd: number;
  priorityFeesUsd: number | null;
  validatorTotalUsd: number | null;
  serverCostMonthlyUsd: number;
  serverCostProRatedUsd: number;
  netValidatorUsd: number | null;
  fxMethodology: "per-epoch" | "end-of-period";
  endOfPeriodPriceUsd: number;
  hasSelfStakeData: boolean;
  hasPriorityFeeData: boolean;
}

interface ReportResp {
  validatorId: number;
  validatorName: string | null;
  rows: ReportRow[];
  summary: ReportSummary;
}

const fmtMon = (n: number | null | undefined, dp = 4) =>
  n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: dp });
const fmtUsd = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

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
    if (!vQuery.trim()) return validators.slice(0, 50);
    const q = vQuery.trim().toLowerCase();
    return validators
      .filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.authAddress.toLowerCase().includes(q) ||
          String(v.validatorId).includes(q)
      )
      .slice(0, 50);
  }, [validators, vQuery]);

  const buildQuery = (format: "json" | "csv") => {
    if (validatorId == null) return null;
    const params = new URLSearchParams();
    params.set("fx", fx);
    params.set("serverCostUsd", String(serverCostUsd || 0));
    params.set("format", format);
    if (fromDate) params.set("fromDate", new Date(fromDate).toISOString());
    if (toDate) params.set("toDate", new Date(toDate).toISOString());
    return `/api/validators/${validatorId}/report?${params.toString()}`;
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

          <header className="mb-10">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cream-8 bg-cream-5 px-3 py-1">
              <FileText className="h-3.5 w-3.5 text-phase-green" />
              <span className="text-[10px] font-body uppercase tracking-widest text-cream-40">
                Reports
              </span>
            </div>
            <h1 className="font-display text-3xl text-cream tracking-wide">
              Validator income reports
            </h1>
            <p className="mt-3 text-sm font-body text-cream-60 leading-relaxed">
              Tax/accounting-grade exports. Pick a validator, choose a date
              range, set your FX methodology and monthly server cost, and
              export to CSV or print to PDF. Includes real per-block priority
              fees, commission, and self-stake share.
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
                    Selected: <span className="text-cream">{selectedValidator.name}</span>{" "}
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
                  {(["per-epoch", "end-of-period"] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setFx(opt)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-xs font-body transition-all ${
                        fx === opt
                          ? "border-phase-green bg-green-dim text-phase-green"
                          : "border-cream-8 bg-dark text-cream-60 hover:border-cream-20"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                <p className="mt-1 flex items-start gap-1.5 text-[10px] font-body text-cream-40">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {fx === "per-epoch"
                      ? "Each epoch's MON valued at that epoch's price."
                      : "All MON valued at the last epoch's price (single FX rate)."}
                  </span>
                </p>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-body uppercase tracking-widest text-cream-40">
                  Server cost (USD/month)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={serverCostUsd || ""}
                  onChange={(e) => setServerCostUsd(Number(e.target.value) || 0)}
                  placeholder="0"
                  className="w-full rounded-lg border border-cream-8 bg-dark px-3 py-2 text-sm font-body text-cream focus:border-cream-20 focus:outline-none"
                />
                <p className="mt-1 text-[10px] font-body text-cream-40">
                  Pro-rated over the observed window and netted from gross
                  validator income.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                onClick={runReport}
                disabled={!validatorId || loading}
                className="inline-flex items-center gap-2 rounded-lg border border-phase-green bg-green-dim px-4 py-2 text-xs font-body text-phase-green transition-all hover:bg-phase-green hover:text-dark disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Calculator className="h-3.5 w-3.5" />
                {loading ? "Running…" : "Run report"}
              </button>
              <button
                onClick={downloadCsv}
                disabled={!validatorId}
                className="inline-flex items-center gap-2 rounded-lg border border-cream-8 bg-cream-5 px-4 py-2 text-xs font-body text-cream-60 transition-all hover:border-cream-20 hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FileDown className="h-3.5 w-3.5" /> Export CSV
              </button>
              <button
                onClick={printPdf}
                disabled={!data}
                className="inline-flex items-center gap-2 rounded-lg border border-cream-8 bg-cream-5 px-4 py-2 text-xs font-body text-cream-60 transition-all hover:border-cream-20 hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FileText className="h-3.5 w-3.5" /> Print to PDF
              </button>
            </div>
            {err && (
              <p className="mt-3 text-xs font-body text-phase-red">{err}</p>
            )}
          </section>
        </div>

        {/* Report output */}
        {data && (
          <section
            id="report-output"
            className="rounded-xl border border-cream-8 bg-cream-5 p-6 print:rounded-none print:border-none print:bg-white print:p-0"
          >
            <header className="mb-6 border-b border-cream-8 pb-4 print:border-black/20">
              <h2 className="font-display text-2xl text-cream tracking-wide print:text-black">
                {data.validatorName ?? `Validator #${data.validatorId}`}
              </h2>
              <p className="mt-1 text-xs font-body text-cream-60 print:text-black/70">
                Validator ID #{data.validatorId} · Window:{" "}
                {data.summary.firstTimestamp
                  ? new Date(data.summary.firstTimestamp).toLocaleDateString()
                  : "—"}{" "}
                →{" "}
                {data.summary.lastTimestamp
                  ? new Date(data.summary.lastTimestamp).toLocaleDateString()
                  : "—"}{" "}
                · Epochs {data.summary.firstEpoch}–{data.summary.lastEpoch} (
                {data.summary.epochCount} rows · {data.summary.observedDays.toFixed(2)}{" "}
                days observed) · FX:{" "}
                <span className="font-mono">{data.summary.fxMethodology}</span>
              </p>
            </header>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Pool rewards (MON)" value={fmtMon(data.summary.poolRewardsMon)} />
              <Stat label="Commission (MON)" value={fmtMon(data.summary.commissionMon)} />
              <Stat
                label="Priority fees (MON)"
                value={
                  data.summary.hasPriorityFeeData
                    ? fmtMon(data.summary.priorityFeesMon)
                    : "no indexer data"
                }
              />
              <Stat
                label="Validator total (MON)"
                value={
                  data.summary.hasSelfStakeData
                    ? fmtMon(data.summary.validatorTotalMon)
                    : "no self-stake data"
                }
              />

              <Stat label="Pool rewards (USD)" value={fmtUsd(data.summary.poolRewardsUsd)} />
              <Stat label="Commission (USD)" value={fmtUsd(data.summary.commissionUsd)} />
              <Stat label="Priority fees (USD)" value={fmtUsd(data.summary.priorityFeesUsd)} />
              <Stat label="Validator total (USD)" value={fmtUsd(data.summary.validatorTotalUsd)} />
            </div>

            {data.summary.serverCostMonthlyUsd > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-4 rounded-lg border border-cream-8 bg-dark p-4 md:grid-cols-3 print:bg-transparent">
                <Stat
                  label="Server cost (USD/mo)"
                  value={fmtUsd(data.summary.serverCostMonthlyUsd)}
                />
                <Stat
                  label="Cost pro-rated"
                  value={fmtUsd(data.summary.serverCostProRatedUsd)}
                />
                <Stat
                  label="Net validator (USD)"
                  value={fmtUsd(data.summary.netValidatorUsd)}
                  emphasize
                />
              </div>
            )}

            <h3 className="mt-8 mb-3 font-display text-sm text-cream tracking-wide print:text-black">
              Per-epoch breakdown
            </h3>
            <div className="overflow-x-auto rounded-lg border border-cream-8 print:border-black/20">
              <table className="w-full text-[11px] font-body">
                <thead className="bg-cream-5 text-cream-40 print:bg-transparent print:text-black/60">
                  <tr>
                    <Th>Epoch</Th>
                    <Th>Date</Th>
                    <Th align="right">Stake (MON)</Th>
                    <Th align="right">Comm %</Th>
                    <Th align="right">Pool</Th>
                    <Th align="right">Commission</Th>
                    <Th align="right">Pri. Fees</Th>
                    <Th align="right">Validator $</Th>
                    <Th align="right">FX $/MON</Th>
                  </tr>
                </thead>
                <tbody className="text-cream-60 print:text-black">
                  {data.rows.map((r) => (
                    <tr key={r.epoch} className="border-t border-cream-8 print:border-black/10">
                      <Td mono>{r.epoch}</Td>
                      <Td>{new Date(r.timestamp).toLocaleDateString()}</Td>
                      <Td align="right">{fmtMon(r.stakeMon, 0)}</Td>
                      <Td align="right">{r.commissionPct.toFixed(1)}</Td>
                      <Td align="right">{fmtMon(r.poolRewardsMon, 2)}</Td>
                      <Td align="right">{fmtMon(r.commissionMon, 4)}</Td>
                      <Td align="right">{fmtMon(r.priorityFeesMon, 4)}</Td>
                      <Td align="right">{fmtUsd(r.validatorTotalUsd)}</Td>
                      <Td align="right">${r.fxPriceUsd.toFixed(4)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-[10px] font-body text-cream-40 print:text-black/60">
              FX methodology: <span className="font-mono">{data.summary.fxMethodology}</span>
              {data.summary.fxMethodology === "end-of-period" && (
                <>
                  {" "}
                  · End-of-period price: ${data.summary.endOfPeriodPriceUsd.toFixed(4)}
                </>
              )}{" "}
              · Source code:{" "}
              <a
                className="underline"
                href="https://github.com/Devour6/monad-income-tracker"
                target="_blank"
                rel="noopener noreferrer"
              >
                Devour6/monad-income-tracker
              </a>
            </p>
          </section>
        )}

        <div className="print:hidden">
          <Footer />
        </div>
      </div>

      <style jsx global>{`
        @media print {
          body::before {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}

function Stat({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 print:text-black/60">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-sm print:text-black ${
          emphasize ? "text-phase-green" : "text-cream"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-3 py-2 text-[10px] font-body uppercase tracking-widest ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  mono,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
}) {
  return (
    <td
      className={`px-3 py-1.5 ${align === "right" ? "text-right" : "text-left"} ${
        mono ? "font-mono" : ""
      }`}
    >
      {children}
    </td>
  );
}
