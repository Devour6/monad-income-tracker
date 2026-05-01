"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Zap, AlertTriangle } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";

interface NetworkPoint {
  epoch: number;
  feesMon: number;
  feesUsd: number;
  blocks: number;
  avgFeePerBlockMon: number;
  monPriceUsd: number;
}

interface LeaderboardRow {
  validatorId: number;
  name: string;
  authAddress: string | null;
  commissionPct: number | null;
  stakeMon: number | null;
  feesMon: number;
  feesUsd: number;
  blocks: number;
  avgFeePerBlockMon: number;
  shareOfNetwork: number;
}

interface UnmappedMiner {
  minerAddress: string;
  feesMon: number;
  blocks: number;
}

interface MevResp {
  window: {
    fromEpoch: number;
    toEpoch: number;
    epochSpan: number;
    approxDays: number;
  } | null;
  totals: {
    networkFeesMon: number;
    networkFeesUsd: number;
    networkBlocks: number;
    avgFeePerBlockMon: number;
    latestMonPriceUsd: number;
  };
  networkSeries: NetworkPoint[];
  validatorLeaderboard: LeaderboardRow[];
  unmappedMiners: UnmappedMiner[];
}

const fmtMon = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 4 });
const fmtUsd = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(2)}%`;

export default function MevPage() {
  const [lookback, setLookback] = useState<number>(30);
  const [data, setData] = useState<MevResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/mev?lookback=${lookback}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setErr(d.error);
        else setData(d);
      })
      .catch((e) => !cancelled && setErr(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [lookback]);

  const top10ByShare = useMemo(() => {
    if (!data) return [];
    return data.validatorLeaderboard.slice(0, 10);
  }, [data]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-dark">
      <AuroraBg />
      <FloatingParticles />

      <div className="relative z-10 mx-auto max-w-6xl px-6 py-12">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-xs font-body text-cream-40 transition-all hover:text-cream-60"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>

        <header className="mb-10">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cream-8 bg-cream-5 px-3 py-1">
            <Zap className="h-3.5 w-3.5 text-phase-green" />
            <span className="text-[10px] font-body uppercase tracking-widest text-cream-40">
              MEV / priority fees
            </span>
          </div>
          <h1 className="font-display text-3xl text-cream tracking-wide">
            Network priority-fee analytics
          </h1>
          <p className="mt-3 text-sm font-body text-cream-60 leading-relaxed">
            Real per-block priority fees, indexed from Monad RPC. On Monad,
            100% of priority fees go to the block proposer (no delegator
            share absent <code className="font-mono text-xs text-phase-green">externalReward()</code>),
            so this is direct validator-company income on top of pool
            commission.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {[7, 30, 90, 180].map((d) => (
              <button
                key={d}
                onClick={() => setLookback(d)}
                className={`rounded-full border px-3 py-1 text-[11px] font-body transition-all ${
                  lookback === d
                    ? "border-phase-green bg-green-dim text-phase-green"
                    : "border-cream-8 bg-cream-5 text-cream-60 hover:border-cream-20"
                }`}
              >
                {d}-epoch lookback (~{(d / 4.36).toFixed(0)}d)
              </button>
            ))}
          </div>
        </header>

        {loading && (
          <p className="text-xs font-body text-cream-40">Loading…</p>
        )}
        {err && <p className="text-xs font-body text-phase-red">{err}</p>}

        {data && data.window && (
          <>
            <section className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat
                label="Total fees (MON)"
                value={fmtMon(data.totals.networkFeesMon)}
              />
              <Stat
                label="Total fees (USD)"
                value={fmtUsd(data.totals.networkFeesUsd)}
              />
              <Stat
                label="Blocks indexed"
                value={data.totals.networkBlocks.toLocaleString()}
              />
              <Stat
                label="Avg / block (MON)"
                value={fmtMon(data.totals.avgFeePerBlockMon)}
              />
            </section>

            <section className="mb-8 rounded-xl border border-cream-8 bg-cream-5 p-5">
              <h3 className="mb-3 font-display text-sm text-cream tracking-wide">
                Network fees per epoch
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data.networkSeries}>
                  <defs>
                    <linearGradient id="mev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FCE184" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#FCE184" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(243,238,217,0.06)" />
                  <XAxis
                    dataKey="epoch"
                    stroke="rgba(243,238,217,0.4)"
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    stroke="rgba(243,238,217,0.4)"
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0F0E0C",
                      border: "1px solid rgba(243,238,217,0.12)",
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                    labelStyle={{ color: "rgba(243,238,217,0.6)" }}
                    formatter={(v: number) => [fmtMon(v), "Fees (MON)"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="feesMon"
                    stroke="#FCE184"
                    strokeWidth={2}
                    fill="url(#mev)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </section>

            <section className="mb-8 rounded-xl border border-cream-8 bg-cream-5 p-5">
              <h3 className="mb-3 font-display text-sm text-cream tracking-wide">
                Top 10 validators by priority-fee share
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={top10ByShare}
                  layout="vertical"
                  margin={{ left: 80 }}
                >
                  <CartesianGrid stroke="rgba(243,238,217,0.06)" />
                  <XAxis
                    type="number"
                    stroke="rgba(243,238,217,0.4)"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) => `${(v * 100).toFixed(1)}%`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="rgba(243,238,217,0.4)"
                    tick={{ fontSize: 10 }}
                    width={80}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0F0E0C",
                      border: "1px solid rgba(243,238,217,0.12)",
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                    labelStyle={{ color: "rgba(243,238,217,0.6)" }}
                    formatter={(v: number) => [fmtPct(v), "Share"]}
                  />
                  <Bar dataKey="shareOfNetwork" fill="#80D0FF" />
                </BarChart>
              </ResponsiveContainer>
            </section>

            <section className="mb-8 rounded-xl border border-cream-8 bg-cream-5 p-5">
              <h3 className="mb-3 font-display text-sm text-cream tracking-wide">
                Full leaderboard
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-body">
                  <thead className="text-cream-40">
                    <tr>
                      <Th>#</Th>
                      <Th>Validator</Th>
                      <Th align="right">Blocks</Th>
                      <Th align="right">Fees (MON)</Th>
                      <Th align="right">Fees (USD)</Th>
                      <Th align="right">Avg/block</Th>
                      <Th align="right">Share</Th>
                      <Th align="right">Comm %</Th>
                    </tr>
                  </thead>
                  <tbody className="text-cream-60">
                    {data.validatorLeaderboard.map((v, i) => (
                      <tr
                        key={v.validatorId}
                        className="border-t border-cream-8 transition-colors hover:bg-cream-5"
                      >
                        <Td mono>{i + 1}</Td>
                        <Td>
                          <Link
                            href={`/validators/${v.validatorId}`}
                            className="text-cream hover:underline"
                          >
                            {v.name}
                          </Link>
                          <span className="ml-1 text-[10px] text-cream-40">
                            #{v.validatorId}
                          </span>
                        </Td>
                        <Td align="right">{v.blocks.toLocaleString()}</Td>
                        <Td align="right">{fmtMon(v.feesMon)}</Td>
                        <Td align="right">{fmtUsd(v.feesUsd)}</Td>
                        <Td align="right">{fmtMon(v.avgFeePerBlockMon)}</Td>
                        <Td align="right">{fmtPct(v.shareOfNetwork)}</Td>
                        <Td align="right">
                          {v.commissionPct != null
                            ? `${v.commissionPct}%`
                            : "—"}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {data.unmappedMiners.length > 0 && (
              <section className="mb-8 rounded-xl border border-yellow-dim bg-yellow-dim p-5">
                <h3 className="mb-2 flex items-center gap-2 font-display text-sm text-phase-yellow tracking-wide">
                  <AlertTriangle className="h-4 w-4" />
                  Unmapped miners
                </h3>
                <p className="mb-3 text-[11px] font-body text-cream-60">
                  These addresses are producing blocks but aren&apos;t yet
                  attributed to a validator. Operators: file a mapping via{" "}
                  <code className="font-mono text-xs text-phase-yellow">
                    /api/admin/map-miner
                  </code>
                  .
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] font-body">
                    <thead className="text-cream-40">
                      <tr>
                        <Th>Miner address</Th>
                        <Th align="right">Blocks</Th>
                        <Th align="right">Fees (MON)</Th>
                      </tr>
                    </thead>
                    <tbody className="text-cream-60">
                      {data.unmappedMiners.map((m) => (
                        <tr
                          key={m.minerAddress}
                          className="border-t border-cream-8"
                        >
                          <Td mono>{m.minerAddress}</Td>
                          <Td align="right">{m.blocks.toLocaleString()}</Td>
                          <Td align="right">{fmtMon(m.feesMon)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}

        <Footer />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-cream-8 bg-cream-5 p-3">
      <div className="text-[10px] font-body uppercase tracking-widest text-cream-40">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm text-cream">{value}</div>
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
