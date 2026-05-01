"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Coins, Info, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Line,
  ComposedChart,
} from "recharts";
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

interface SimResp {
  validatorId: number;
  input: { stakeMon: number; horizonDays: number; lookback: number };
  observed: {
    epochCount: number;
    epochSpan: number;
    approxDays: number;
    meanReturnPerEpoch: number;
    sigmaReturnPerEpoch: number;
    latestMonPriceUsd: number;
  };
  apy: { mean: number; p10: number; p90: number };
  backtest: Array<{
    epoch: number;
    cumulativeMon: number;
    cumulativeUsd: number;
  }>;
  projection: Array<{
    day: number;
    meanMon: number;
    p10Mon: number;
    p90Mon: number;
    meanUsd: number;
    p10Usd: number;
    p90Usd: number;
  }>;
}

const fmtMon = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 4 });
const fmtUsd = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function SimulatePage() {
  const [validators, setValidators] = useState<ValidatorListItem[]>([]);
  const [validatorId, setValidatorId] = useState<number | null>(null);
  const [vQuery, setVQuery] = useState("");
  const [stakeMon, setStakeMon] = useState<number>(1000);
  const [horizonDays, setHorizonDays] = useState<number>(365);
  const [lookback, setLookback] = useState<number>(60);
  const [data, setData] = useState<SimResp | null>(null);
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

  const run = async () => {
    if (validatorId == null || stakeMon <= 0) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({
        stakeMon: String(stakeMon),
        horizonDays: String(horizonDays),
        lookback: String(lookback),
      });
      const r = await fetch(
        `/api/validators/${validatorId}/simulate?${params.toString()}`
      );
      const d = await r.json();
      if (d.error) setErr(d.error);
      else setData(d);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const selected = validators.find((v) => v.validatorId === validatorId);

  return (
    <div className="relative min-h-screen overflow-hidden bg-dark">
      <AuroraBg />
      <FloatingParticles />

      <div className="relative z-10 mx-auto max-w-5xl px-6 py-12">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-xs font-body text-cream-40 transition-all hover:text-cream-60"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>

        <header className="mb-10">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cream-8 bg-cream-5 px-3 py-1">
            <Coins className="h-3.5 w-3.5 text-phase-green" />
            <span className="text-[10px] font-body uppercase tracking-widest text-cream-40">
              Delegator simulator
            </span>
          </div>
          <h1 className="font-display text-3xl text-cream tracking-wide">
            Project your delegator income
          </h1>
          <p className="mt-3 text-sm font-body text-cream-60 leading-relaxed">
            Pick a validator, choose a stake size and horizon, and see what
            you would have earned historically vs. what to expect going
            forward — with a 1.28σ (≈ p10/p90) band based on observed
            per-epoch variance.
          </p>
        </header>

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
              {selected && (
                <div className="mt-2 text-[11px] font-body text-cream-60">
                  Selected: <span className="text-cream">{selected.name}</span> (#
                  {selected.validatorId})
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-body uppercase tracking-widest text-cream-40">
                  Stake (MON)
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={stakeMon}
                  onChange={(e) => setStakeMon(Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-cream-8 bg-dark px-3 py-2 text-sm font-body text-cream focus:border-cream-20 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-body uppercase tracking-widest text-cream-40">
                  Horizon (days)
                </label>
                <input
                  type="number"
                  min={1}
                  max={1825}
                  step={1}
                  value={horizonDays}
                  onChange={(e) => setHorizonDays(Number(e.target.value) || 365)}
                  className="w-full rounded-lg border border-cream-8 bg-dark px-3 py-2 text-sm font-body text-cream focus:border-cream-20 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-body uppercase tracking-widest text-cream-40">
                  Lookback (epochs)
                </label>
                <input
                  type="number"
                  min={7}
                  max={365}
                  step={1}
                  value={lookback}
                  onChange={(e) => setLookback(Number(e.target.value) || 60)}
                  className="w-full rounded-lg border border-cream-8 bg-dark px-3 py-2 text-sm font-body text-cream focus:border-cream-20 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="mt-5">
            <button
              onClick={run}
              disabled={!validatorId || stakeMon <= 0 || loading}
              className="inline-flex items-center gap-2 rounded-lg border border-phase-green bg-green-dim px-4 py-2 text-xs font-body text-phase-green transition-all hover:bg-phase-green hover:text-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              <TrendingUp className="h-3.5 w-3.5" />
              {loading ? "Simulating…" : "Simulate"}
            </button>
            {err && (
              <p className="mt-3 text-xs font-body text-phase-red">{err}</p>
            )}
          </div>
        </section>

        {data && (
          <>
            <section className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Mean APY" value={`${data.apy.mean.toFixed(2)}%`} />
              <Stat
                label="p10 APY"
                value={`${data.apy.p10.toFixed(2)}%`}
                muted
              />
              <Stat
                label="p90 APY"
                value={`${data.apy.p90.toFixed(2)}%`}
                muted
              />
              <Stat
                label="Observed window"
                value={`${data.observed.approxDays.toFixed(1)} days`}
                muted
              />
            </section>

            <section className="mb-6 rounded-xl border border-cream-8 bg-cream-5 p-5">
              <h3 className="mb-3 font-display text-sm text-cream tracking-wide">
                Forward projection — cumulative MON earned
              </h3>
              <p className="mb-3 flex items-start gap-1.5 text-[10px] font-body text-cream-40">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  Mean = expected, band = ±1.28σ (≈ p10/p90) of observed
                  per-epoch return variance, scaled by √(epochs elapsed).
                  Assumes no commission change, no slashing, no protocol
                  parameter change.
                </span>
              </p>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={data.projection}>
                  <defs>
                    <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4ade80" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#4ade80" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(243,238,217,0.06)" />
                  <XAxis
                    dataKey="day"
                    stroke="rgba(243,238,217,0.4)"
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    stroke="rgba(243,238,217,0.4)"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) =>
                      v.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0F0E0C",
                      border: "1px solid rgba(243,238,217,0.12)",
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                    labelStyle={{ color: "rgba(243,238,217,0.6)" }}
                    formatter={(v: number, name: string) => [
                      fmtMon(v),
                      name,
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="p90Mon"
                    stroke="none"
                    fill="url(#band)"
                  />
                  <Area
                    type="monotone"
                    dataKey="p10Mon"
                    stroke="none"
                    fill="#0F0E0C"
                  />
                  <Line
                    type="monotone"
                    dataKey="meanMon"
                    stroke="#4ade80"
                    strokeWidth={2}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>

              <div className="mt-4 grid grid-cols-3 gap-4 text-xs font-body">
                {[1, 30, 365]
                  .filter((d) => d <= data.projection.length)
                  .map((d) => {
                    const p = data.projection[d - 1];
                    return (
                      <div
                        key={d}
                        className="rounded-lg border border-cream-8 bg-dark p-3"
                      >
                        <div className="text-[10px] uppercase tracking-widest text-cream-40">
                          Day {d}
                        </div>
                        <div className="mt-1 font-mono text-cream">
                          {fmtMon(p.meanMon)} MON
                        </div>
                        <div className="text-[10px] text-cream-40">
                          ({fmtMon(p.p10Mon)} – {fmtMon(p.p90Mon)})
                        </div>
                        <div className="mt-1 text-[11px] text-cream-60">
                          {fmtUsd(p.meanUsd)}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </section>

            <section className="mb-6 rounded-xl border border-cream-8 bg-cream-5 p-5">
              <h3 className="mb-3 font-display text-sm text-cream tracking-wide">
                Backtest — what your stake would have earned over the lookback
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={data.backtest}>
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
                    formatter={(v: number) => [fmtMon(v), "Cumulative MON"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="cumulativeMon"
                    stroke="#FCE184"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              {data.backtest.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-4 text-xs font-body">
                  <Stat
                    label="Backtest total (MON)"
                    value={fmtMon(
                      data.backtest[data.backtest.length - 1].cumulativeMon
                    )}
                  />
                  <Stat
                    label="Backtest total (USD)"
                    value={fmtUsd(
                      data.backtest[data.backtest.length - 1].cumulativeUsd
                    )}
                  />
                </div>
              )}
            </section>
          </>
        )}

        <Footer />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg border border-cream-8 bg-cream-5 p-3">
      <div className="text-[10px] font-body uppercase tracking-widest text-cream-40">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-sm ${
          muted ? "text-cream-60" : "text-cream"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
