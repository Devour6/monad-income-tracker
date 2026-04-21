"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Wallet,
  Users,
  TrendingUp,
  Clock,
  Server,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";
import { ScrollReveal } from "@/components/scroll-reveal";
import { IncomeChart } from "@/components/income/income-chart";
import { IncomeTable } from "@/components/income/income-table";

interface ValidatorDetail {
  validator: {
    validatorId: number;
    name: string;
    authAddress: string;
    stakeMon: number;
    commissionPct: number;
    lastEpoch: number | null;
    updatedAt: string;
  };
  apy: number;
  income: {
    observed: {
      epochCount: number;
      snapshotCount: number;
      daysObserved: number;
      poolRewardsMon: number;
      commissionMon: number;
      delegatorRewardsMon: number;
    };
    rates: {
      commissionPerEpochMon: number;
      commissionPerDayMon: number;
      commissionPerMonthMon: number;
      commissionPerYearMon: number;
      poolPerEpochMon: number;
      poolPerDayMon: number;
      poolPerMonthMon: number;
      poolPerYearMon: number;
    };
  };
  stakeHistory: Array<{ epoch: number; stakeMon: number; stakeWei: string }>;
  commissionHistory: Array<{ epoch: number; commissionPct: number }>;
  latestEpoch: number | null;
}

interface EpochIncome {
  epoch: number;
  epochSpan: number;
  poolRewardsMon: number;
  commissionMon: number;
  delegatorRewardsMon: number;
  poolRewardsUsd: number;
  commissionUsd: number;
  stakeMon: number;
  commissionPct: number;
  monPriceUsd: number;
  timestamp: string;
}

interface LiveData {
  monPrice: number;
  networkStake: number;
  activeValidators: number;
  updatedAt: string | null;
}

function formatMon(n: number): string {
  if (!isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function formatUsd(n: number): string {
  if (!n || !isFinite(n) || n === 0) return "";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function formatDays(days: number): string {
  if (days < 1) return `${(days * 24).toFixed(1)} hours`;
  if (days < 30) return `${days.toFixed(1)} days`;
  if (days < 365) return `${(days / 30).toFixed(1)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

export default function ValidatorDetailPage() {
  const params = useParams();
  const validatorId = params?.id as string;

  const [detail, setDetail] = useState<ValidatorDetail | null>(null);
  const [income, setIncome] = useState<EpochIncome[]>([]);
  const [monPrice, setMonPrice] = useState(0);
  const [loading, setLoading] = useState(true);
  const [epochCount, setEpochCount] = useState(30);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(
    async (epochs: number) => {
      if (!validatorId) return;
      setLoading(true);
      setError(null);
      try {
        const [detailRes, incomeRes, liveRes] = await Promise.all([
          fetch(`/api/validators/${validatorId}?epochs=${epochs}`),
          fetch(`/api/validators/${validatorId}/income?epochs=${epochs}`),
          fetch(`/api/live-data`),
        ]);

        if (!detailRes.ok) {
          const err = await detailRes.json();
          throw new Error(err.error || "Failed to load validator");
        }

        const [detailData, incomeData, liveData] = await Promise.all([
          detailRes.json() as Promise<ValidatorDetail>,
          incomeRes.json() as Promise<{ epochs: EpochIncome[] }>,
          liveRes.json() as Promise<LiveData>,
        ]);

        setDetail(detailData);
        setIncome(incomeData.epochs || []);
        setMonPrice(liveData.monPrice || 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [validatorId]
  );

  useEffect(() => {
    fetchAll(epochCount);
  }, [fetchAll, epochCount]);

  return (
    <div className="relative z-[1] px-6 pt-8 pb-6">
      <AuroraBg />
      <FloatingParticles />
      <div className="max-w-[1340px] mx-auto">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-cream-40 text-xs font-body hover:text-phase-green transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Income Tracker
        </Link>

        {/* Header */}
        {detail && (
          <header className="mb-10 pb-7 border-b border-cream-8 opacity-0 animate-fade-in-up">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <Server className="w-6 h-6 text-cream-40" />
              <h1 className="font-display text-[28px] font-normal text-cream tracking-[0.03em]">
                {detail.validator.name}
              </h1>
              <span className="text-cream-40 text-sm font-mono">
                #{detail.validator.validatorId}
              </span>
            </div>
            <div className="flex items-center gap-2 text-cream-40 text-xs font-mono">
              <span>{detail.validator.authAddress}</span>
              <a
                href={`https://monadexplorer.com/address/${detail.validator.authAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-phase-green transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </header>
        )}

        {loading && !detail && (
          <div className="text-center py-20 text-cream-40 text-sm font-body animate-pulse">
            Loading validator data...
          </div>
        )}

        {error && (
          <div className="text-center py-20">
            <div className="inline-flex flex-col items-center gap-4 bg-phase-red/10 border border-phase-red/30 rounded-2xl px-8 py-6">
              <div className="text-phase-red text-sm font-body">{error}</div>
            </div>
          </div>
        )}

        {detail && (
          <>
            {/* Key stats row */}
            <ScrollReveal delay={0}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="w-4 h-4 text-cream-40" />
                    <span className="text-cream-40 text-xs font-body uppercase tracking-wider">
                      Total Stake
                    </span>
                  </div>
                  <div className="text-cream text-2xl font-body font-semibold">
                    {formatMon(detail.validator.stakeMon)}
                  </div>
                  <div className="text-cream-20 text-xs mt-1">MON</div>
                </div>
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Wallet className="w-4 h-4 text-cream-40" />
                    <span className="text-cream-40 text-xs font-body uppercase tracking-wider">
                      Commission
                    </span>
                  </div>
                  <div className="text-cream text-2xl font-body font-semibold">
                    {detail.validator.commissionPct.toFixed(1)}%
                  </div>
                  <div className="text-cream-20 text-xs mt-1">
                    Validator keeps
                  </div>
                </div>
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="w-4 h-4 text-cream-40" />
                    <span className="text-cream-40 text-xs font-body uppercase tracking-wider">
                      Pool APY
                    </span>
                  </div>
                  <div className="text-cream text-2xl font-body font-semibold">
                    {detail.apy.toFixed(2)}%
                  </div>
                  <div className="text-cream-20 text-xs mt-1">
                    Gross, from latest 2 snapshots
                  </div>
                </div>
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="w-4 h-4 text-cream-40" />
                    <span className="text-cream-40 text-xs font-body uppercase tracking-wider">
                      Latest Epoch
                    </span>
                  </div>
                  <div className="text-cream text-2xl font-body font-semibold">
                    {detail.latestEpoch ?? "—"}
                  </div>
                  <div className="text-cream-20 text-xs mt-1">
                    Last snapshot
                  </div>
                </div>
              </div>
            </ScrollReveal>

            {/* Epoch range selector */}
            <div className="flex items-center justify-end gap-2 mb-4">
              <span className="text-cream-40 text-xs font-body">Showing</span>
              {[30, 60, 90, 180].map((n) => (
                <button
                  key={n}
                  onClick={() => setEpochCount(n)}
                  className={`px-3 py-1 text-xs rounded-full font-body transition-all ${
                    epochCount === n
                      ? "bg-cream text-dark font-medium"
                      : "bg-cream-5 text-cream-40 hover:bg-cream-8 hover:text-cream-60"
                  }`}
                >
                  {n} epochs
                </button>
              ))}
            </div>

            {/* Realized earnings */}
            <ScrollReveal delay={100}>
              <div className="mb-6">
                <h3 className="text-cream-40 text-[11px] font-body uppercase tracking-[0.12em] mb-3">
                  Realized Earnings
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-phase-green/5 border border-phase-green/20 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Wallet className="w-4 h-4 text-phase-green" />
                      <span className="text-phase-green text-xs font-body uppercase tracking-wider">
                        Validator Commission
                      </span>
                    </div>
                    <div className="text-phase-green text-3xl font-body font-semibold">
                      {formatMon(detail.income.observed.commissionMon)}
                      <span className="text-phase-green/60 text-sm ml-2">
                        MON
                      </span>
                    </div>
                    {monPrice > 0 && (
                      <div className="text-phase-green/70 text-xs mt-1">
                        {formatUsd(detail.income.observed.commissionMon * monPrice)}
                      </div>
                    )}
                    <div className="text-phase-green/60 text-xs font-body mt-2">
                      Over {formatDays(detail.income.observed.daysObserved)}
                    </div>
                  </div>
                  <div className="bg-cream-5 border border-cream-8 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Users className="w-4 h-4 text-cream-40" />
                      <span className="text-cream-40 text-xs font-body uppercase tracking-wider">
                        Pool Total
                      </span>
                    </div>
                    <div className="text-cream text-3xl font-body font-semibold">
                      {formatMon(detail.income.observed.poolRewardsMon)}
                      <span className="text-cream-40 text-sm ml-2">MON</span>
                    </div>
                    {monPrice > 0 && (
                      <div className="text-cream-20 text-xs mt-1">
                        {formatUsd(
                          detail.income.observed.poolRewardsMon * monPrice
                        )}
                      </div>
                    )}
                    <div className="text-cream-20 text-xs font-body mt-2">
                      Earned by validator + all delegators
                    </div>
                  </div>
                  <div className="bg-cream-5 border border-cream-8 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Users className="w-4 h-4 text-cream-40" />
                      <span className="text-cream-40 text-xs font-body uppercase tracking-wider">
                        Delegator Payout
                      </span>
                    </div>
                    <div className="text-cream text-3xl font-body font-semibold">
                      {formatMon(detail.income.observed.delegatorRewardsMon)}
                      <span className="text-cream-40 text-sm ml-2">MON</span>
                    </div>
                    <div className="text-cream-20 text-xs font-body mt-2">
                      Paid to delegators (after commission)
                    </div>
                  </div>
                </div>
              </div>
            </ScrollReveal>

            {/* Commission run rate */}
            <ScrollReveal delay={150}>
              <div className="mb-6">
                <h3 className="text-cream-40 text-[11px] font-body uppercase tracking-[0.12em] mb-3 flex items-center gap-2">
                  <TrendingUp className="w-3 h-3" />
                  Commission Run Rate
                  <span className="text-cream-20 text-[10px] normal-case tracking-normal font-light">
                    (extrapolated from observed average — not realized)
                  </span>
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    {
                      label: "Per Day",
                      mon: detail.income.rates.commissionPerDayMon,
                    },
                    {
                      label: "Per Month",
                      mon: detail.income.rates.commissionPerMonthMon,
                    },
                    {
                      label: "Per Year",
                      mon: detail.income.rates.commissionPerYearMon,
                    },
                  ].map((r) => (
                    <div
                      key={r.label}
                      className="bg-cream-5 border border-cream-8 rounded-xl p-4"
                    >
                      <div className="text-cream-40 text-xs font-body uppercase tracking-wider mb-2">
                        {r.label}
                      </div>
                      <div className="text-cream text-xl font-body font-semibold">
                        {formatMon(r.mon)}
                        <span className="text-cream-40 text-xs ml-1">MON</span>
                      </div>
                      {monPrice > 0 && (
                        <div className="text-cream-20 text-xs mt-1">
                          {formatUsd(r.mon * monPrice)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </ScrollReveal>

            {/* Income chart (commission + pool) */}
            <ScrollReveal delay={200}>
              <IncomeChart data={income} loading={loading} />
            </ScrollReveal>

            {/* Stake history chart */}
            {detail.stakeHistory.length > 1 && (
              <ScrollReveal delay={250}>
                <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
                  <h3 className="text-cream text-sm font-body font-medium uppercase tracking-wider mb-4">
                    Stake History
                  </h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={[...detail.stakeHistory].reverse()}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(243,238,217,0.04)"
                      />
                      <XAxis
                        dataKey="epoch"
                        tick={{ fill: "rgba(243,238,217,0.3)", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fill: "rgba(243,238,217,0.3)", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => formatMon(v)}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#0f0c0e",
                          border: "1px solid rgba(243,238,217,0.12)",
                          borderRadius: "8px",
                          color: "#F3EED9",
                          fontSize: "12px",
                        }}
                        formatter={(value: number) => [
                          `${formatMon(value)} MON`,
                          "Stake",
                        ]}
                      />
                      <Line
                        type="monotone"
                        dataKey="stakeMon"
                        stroke="#80d0ff"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </ScrollReveal>
            )}

            {/* Income table */}
            <ScrollReveal delay={300}>
              <IncomeTable data={income} loading={loading} />
            </ScrollReveal>
          </>
        )}

        <Footer />
      </div>
    </div>
  );
}
