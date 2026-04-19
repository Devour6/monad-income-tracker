"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  ArrowLeft,
  ArrowUpDown,
  ArrowRight,
  Download,
  Server,
  TrendingUp,
  Coins,
  CalendarDays,
  Zap,
  Percent,
  Layers,
} from "lucide-react";

import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";
import { ScrollReveal } from "@/components/scroll-reveal";
import { formatMon, formatUsd, formatStake, formatApy } from "@/lib/apy";

/* ─── Types ─────────────────────────────────────────────────────── */

interface ValidatorData {
  validatorId: number;
  name: string;
  authAddress: string;
  stakeMon: number;
  commissionPct: number;
  lastEpoch: number;
  updatedAt: string;
}

interface IncomeOverview {
  totalIncomeMon: number;
  epochsAnalyzed: number;
  avgPerEpoch: number;
  estimatedDailyMon: number;
  estimatedMonthlyMon: number;
  estimatedAnnualMon: number;
}

interface StakeHistoryPoint {
  epoch: number;
  stakeMon: number;
  stakeWei: string;
}

interface CommissionHistoryPoint {
  epoch: number;
  commissionPct: number;
  commissionRaw: string;
}

interface ValidatorDetailResponse {
  validator: ValidatorData;
  apy: number;
  income: IncomeOverview;
  stakeHistory: StakeHistoryPoint[];
  commissionHistory: CommissionHistoryPoint[];
  latestEpoch: number | null;
}

interface EpochIncome {
  epoch: number;
  blockRewardsMon: number;
  commissionMon: number;
  totalMon: number;
  totalUsd: number;
  stakeMon: number;
  monPriceUsd: number;
  timestamp: string;
}

interface IncomeSummaryData {
  totalEpochs: number;
  epochsWithIncome: number;
  totalBlockRewardsMon: number;
  totalBlockRewardsUsd: number;
  totalCommissionMon: number;
  avgBlockRewardsPerEpoch: number;
  estimatedDailyMon: number;
  estimatedDailyUsd: number;
  estimatedMonthlyMon: number;
  estimatedMonthlyUsd: number;
  estimatedAnnualMon: number;
  estimatedAnnualUsd: number;
  latestMonPriceUsd: number;
}

type SortKey =
  | "epoch"
  | "totalMon"
  | "totalUsd"
  | "blockRewardsMon"
  | "commissionMon";
type SortDir = "asc" | "desc";

/* ─── Skeleton ──────────────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <div className="bg-cream-5 border border-cream-8 rounded-xl p-4 card-hover">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-4 h-4 rounded bg-cream-8 animate-pulse" />
        <div className="h-3 w-16 bg-cream-8 rounded animate-pulse" />
      </div>
      <div className="h-8 w-24 bg-cream-5 rounded animate-pulse" />
      <div className="h-3 w-20 bg-cream-5 rounded animate-pulse mt-2" />
    </div>
  );
}

function SkeletonChart() {
  return (
    <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
      <div className="h-64 flex items-center justify-center">
        <div className="text-cream-20 text-sm font-body animate-pulse">
          Loading chart data...
        </div>
      </div>
    </div>
  );
}

/* ─── Income Chart Tooltip ──────────────────────────────────────── */

function IncomeTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: EpochIncome }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;

  return (
    <div className="bg-dark border border-cream-12 rounded-lg px-3 py-2 shadow-xl">
      <div className="text-cream text-xs font-body font-medium mb-1">
        Epoch {d.epoch}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-phase-green">{formatMon(d.totalMon)} MON</span>
        {d.totalUsd > 0 && (
          <span className="text-cream-20">(${d.totalUsd.toFixed(2)})</span>
        )}
      </div>
      {d.commissionMon > 0 && (
        <div className="text-cream-20 text-xs mt-0.5">
          Commission: {formatMon(d.commissionMon)} MON
        </div>
      )}
      <div className="text-cream-20 text-xs mt-0.5">
        {new Date(d.timestamp).toLocaleDateString()}
      </div>
    </div>
  );
}

/* ─── Stake Chart Tooltip ───────────────────────────────────────── */

function StakeTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: StakeHistoryPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;

  return (
    <div className="bg-dark border border-cream-12 rounded-lg px-3 py-2 shadow-xl">
      <div className="text-cream text-xs font-body font-medium mb-1">
        Epoch {d.epoch}
      </div>
      <div className="text-xs">
        <span className="text-[#a78bfa]">{formatStake(d.stakeMon)} MON</span>
      </div>
    </div>
  );
}

/* ─── CSV Export ─────────────────────────────────────────────────── */

function exportCsv(data: EpochIncome[]) {
  const headers = [
    "Epoch",
    "Date",
    "Block Rewards (MON)",
    "Commission (MON)",
    "Total (MON)",
    "Total (USD)",
    "Stake (MON)",
    "MON Price (USD)",
  ];

  const rows = data.map((d) => [
    d.epoch,
    new Date(d.timestamp).toISOString().split("T")[0],
    d.blockRewardsMon,
    d.commissionMon,
    d.totalMon,
    d.totalUsd,
    d.stakeMon,
    d.monPriceUsd,
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `monad-income-${data[0]?.epoch ?? "unknown"}-${data[data.length - 1]?.epoch ?? "unknown"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Main Page ──────────────────────────────────────────────────── */

export default function ValidatorDetailPage() {
  const params = useParams();
  const validatorId = params.id as string;

  const [detail, setDetail] = useState<ValidatorDetailResponse | null>(null);
  const [incomeData, setIncomeData] = useState<EpochIncome[]>([]);
  const [summary, setSummary] = useState<IncomeSummaryData | null>(null);
  const [epochCount, setEpochCount] = useState(30);
  const [loading, setLoading] = useState(true);
  const [incomeLoading, setIncomeLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sort state for income table
  const [sortKey, setSortKey] = useState<SortKey>("epoch");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  /* ── Fetch validator detail ── */
  const fetchDetail = useCallback(
    async (id: string, epochs: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/validators/${id}?epochs=${epochs}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError(`Validator #${id} not found.`);
          } else {
            const body = await res.json().catch(() => ({}));
            setError(body.error || `Failed to load validator (${res.status})`);
          }
          setDetail(null);
          return;
        }
        const data: ValidatorDetailResponse = await res.json();
        setDetail(data);
      } catch {
        setError("Network error. Please try again.");
        setDetail(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /* ── Fetch per-epoch income ── */
  const fetchIncome = useCallback(
    async (id: string, epochs: number) => {
      setIncomeLoading(true);
      try {
        const res = await fetch(
          `/api/validators/${id}/income?epochs=${epochs}`
        );
        const data = await res.json();
        setIncomeData(data.epochs || []);
        setSummary(data.summary || null);
      } catch {
        setIncomeData([]);
        setSummary(null);
      } finally {
        setIncomeLoading(false);
      }
    },
    []
  );

  /* ── Trigger fetches ── */
  useEffect(() => {
    if (validatorId) {
      fetchDetail(validatorId, epochCount);
      fetchIncome(validatorId, epochCount);
    }
  }, [validatorId, epochCount, fetchDetail, fetchIncome]);

  /* ── Sorted income table data ── */
  const sortedIncome = useMemo(() => {
    const copy = [...incomeData];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      return sortDir === "asc"
        ? (av as number) - (bv as number)
        : (bv as number) - (av as number);
    });
    return copy;
  }, [incomeData, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  /* ── Chart data (chronological) ── */
  const incomeChartData = useMemo(
    () => [...incomeData].reverse(),
    [incomeData]
  );

  const stakeChartData = useMemo(() => {
    if (!detail?.stakeHistory) return [];
    return [...detail.stakeHistory].reverse();
  }, [detail?.stakeHistory]);

  /* ── Derived ── */
  const v = detail?.validator;
  const income = detail?.income;
  const apy = detail?.apy ?? 0;

  /* ─────────────────────────────────────────────────────────────── */
  /*  Render                                                        */
  /* ─────────────────────────────────────────────────────────────── */

  return (
    <div className="relative z-[1] px-6 pt-8 pb-6">
      <AuroraBg />
      <FloatingParticles />
      <div className="max-w-[1340px] mx-auto">
        {/* Back Navigation */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-cream-40 text-sm font-body hover:text-cream transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Income Tracker
        </Link>

        {/* ── Error State ── */}
        {error && (
          <div className="text-center py-20">
            <div className="inline-flex flex-col items-center gap-4 bg-cream-5 border border-cream-8 rounded-2xl px-8 py-8">
              <Server className="w-8 h-8 text-cream-20" />
              <div className="text-cream-60 text-sm font-body">{error}</div>
              <Link
                href="/"
                className="text-sm font-body text-cream-40 hover:text-cream transition-colors underline underline-offset-4"
              >
                Return to tracker
              </Link>
            </div>
          </div>
        )}

        {/* ── Loading Skeleton ── */}
        {loading && !error && (
          <>
            {/* Header skeleton */}
            <div className="mb-8 pb-6 border-b border-cream-8">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-8 w-48 bg-cream-8 rounded animate-pulse" />
                <div className="h-5 w-16 bg-cream-5 rounded animate-pulse" />
              </div>
              <div className="h-4 w-96 bg-cream-5 rounded animate-pulse mt-2" />
            </div>

            {/* Stats skeleton */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>

            {/* Chart skeletons */}
            <SkeletonChart />
            <SkeletonChart />
          </>
        )}

        {/* ── Loaded Content ── */}
        {!loading && !error && v && income && (
          <>
            {/* Header */}
            <header
              className="mb-8 pb-6 border-b border-cream-8 opacity-0 animate-fade-in-up"
              style={{ animationDelay: "0.08s" }}
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-2">
                <h1 className="font-display text-[28px] sm:text-[32px] font-normal text-cream tracking-[0.03em]">
                  {v.name}
                </h1>
                <span className="text-cream-20 text-xs font-mono bg-cream-5 border border-cream-8 px-2.5 py-1 rounded-full shrink-0">
                  #{v.validatorId}
                </span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <span className="text-cream-20 text-xs font-mono truncate max-w-[480px]">
                  {v.authAddress}
                </span>
                {detail.latestEpoch !== null && (
                  <span className="inline-flex items-center gap-1.5 text-cream-40 text-xs font-body">
                    <span className="w-1.5 h-1.5 rounded-full bg-phase-green animate-pulse" />
                    Latest epoch: {detail.latestEpoch}
                  </span>
                )}
              </div>

              {/* Action links */}
              <div className="flex items-center gap-4 mt-4">
                <Link
                  href={`/?compare=${v.validatorId}`}
                  className="inline-flex items-center gap-1.5 text-cream-40 text-xs font-body hover:text-cream transition-colors"
                >
                  Compare this validator <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </header>

            {/* Epoch Range Selector */}
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

            {/* ── Stats Cards ── */}
            <ScrollReveal delay={0}>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {/* 1. Total Stake */}
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-4 card-hover">
                  <div className="flex items-center gap-2 mb-3">
                    <Layers className="w-4 h-4 text-cream-40" />
                    <span className="text-cream-40 text-xs font-body uppercase tracking-wider">
                      Total Stake
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-cream text-2xl font-body font-semibold stat-shimmer">
                      {formatStake(v.stakeMon)}
                    </span>
                    <span className="text-cream-40 text-xs font-body">MON</span>
                  </div>
                  <div className="text-cream-20 text-xs font-body mt-1">
                    {formatMon(v.stakeMon)} MON exact
                  </div>
                </div>

                {/* 2. APY */}
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-4 card-hover">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="w-4 h-4 text-cream-40" />
                    <span className="text-cream-40 text-xs font-body uppercase tracking-wider">
                      APY
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={`text-2xl font-body font-semibold stat-shimmer ${
                        apy > 0 ? "text-phase-green" : "text-cream"
                      }`}
                    >
                      {formatApy(apy)}
                    </span>
                  </div>
                  <div className="text-cream-20 text-xs font-body mt-1">
                    Based on latest epoch delta
                  </div>
                </div>

                {/* 3. Commission */}
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-4 card-hover">
                  <div className="flex items-center gap-2 mb-3">
                    <Percent className="w-4 h-4 text-cream-40" />
                    <span className="text-cream-40 text-xs font-body uppercase tracking-wider">
                      Commission
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-cream text-2xl font-body font-semibold stat-shimmer">
                      {v.commissionPct}%
                    </span>
                  </div>
                  <div className="text-cream-20 text-xs font-body mt-1">
                    Validator fee rate
                  </div>
                </div>

                {/* 4. Est. Daily */}
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-4 card-hover">
                  <div className="flex items-center gap-2 mb-3">
                    <CalendarDays className="w-4 h-4 text-cream-40" />
                    <span className="text-cream-40 text-xs font-body uppercase tracking-wider">
                      Est. Daily
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-cream text-2xl font-body font-semibold stat-shimmer">
                      {formatMon(income.estimatedDailyMon)}
                    </span>
                    <span className="text-cream-40 text-xs font-body">MON</span>
                  </div>
                  {summary?.estimatedDailyUsd ? (
                    <div className="text-cream-20 text-xs font-body mt-1">
                      {formatUsd(summary.estimatedDailyUsd)}
                    </div>
                  ) : (
                    <div className="text-cream-20 text-xs font-body mt-1">
                      ~4.36 epochs/day
                    </div>
                  )}
                </div>

                {/* 5. Est. Monthly */}
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-4 card-hover">
                  <div className="flex items-center gap-2 mb-3">
                    <Coins className="w-4 h-4 text-cream-40" />
                    <span className="text-cream-40 text-xs font-body uppercase tracking-wider">
                      Est. Monthly
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-cream text-2xl font-body font-semibold stat-shimmer">
                      {formatMon(income.estimatedMonthlyMon)}
                    </span>
                    <span className="text-cream-40 text-xs font-body">MON</span>
                  </div>
                  {summary?.estimatedMonthlyUsd ? (
                    <div className="text-cream-20 text-xs font-body mt-1">
                      {formatUsd(summary.estimatedMonthlyUsd)}
                    </div>
                  ) : (
                    <div className="text-cream-20 text-xs font-body mt-1">
                      30-day projection
                    </div>
                  )}
                </div>

                {/* 6. Est. Annual */}
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-4 card-hover">
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="w-4 h-4 text-cream-40" />
                    <span className="text-cream-40 text-xs font-body uppercase tracking-wider">
                      Est. Annual
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-cream text-2xl font-body font-semibold stat-shimmer">
                      {formatMon(income.estimatedAnnualMon)}
                    </span>
                    <span className="text-cream-40 text-xs font-body">MON</span>
                  </div>
                  {summary?.estimatedAnnualUsd ? (
                    <div className="text-cream-20 text-xs font-body mt-1">
                      {formatUsd(summary.estimatedAnnualUsd)}
                    </div>
                  ) : (
                    <div className="text-cream-20 text-xs font-body mt-1">
                      365-day projection
                    </div>
                  )}
                </div>
              </div>
            </ScrollReveal>

            {/* ── Income Chart ── */}
            <ScrollReveal delay={100}>
              {incomeLoading ? (
                <SkeletonChart />
              ) : incomeChartData.length === 0 ? (
                <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
                  <div className="h-64 flex items-center justify-center">
                    <div className="text-cream-20 text-sm font-body">
                      No income data available for this epoch range.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-cream text-sm font-body font-medium uppercase tracking-wider">
                      Block Rewards per Epoch
                    </h3>
                    <div className="flex items-center gap-4 text-xs font-body">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-phase-green" />
                        <span className="text-cream-40">Block Rewards</span>
                      </div>
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={incomeChartData}>
                      <defs>
                        <linearGradient
                          id="incomeGrad"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#4ade80"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="100%"
                            stopColor="#4ade80"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(243,238,217,0.04)"
                      />
                      <XAxis
                        dataKey="epoch"
                        tick={{
                          fill: "rgba(243,238,217,0.3)",
                          fontSize: 11,
                        }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{
                          fill: "rgba(243,238,217,0.3)",
                          fontSize: 11,
                        }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => formatMon(val)}
                      />
                      <Tooltip content={<IncomeTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="totalMon"
                        stroke="#4ade80"
                        strokeWidth={2}
                        fill="url(#incomeGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ScrollReveal>

            {/* ── Stake History Chart ── */}
            <ScrollReveal delay={200}>
              {loading ? (
                <SkeletonChart />
              ) : stakeChartData.length === 0 ? (
                <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
                  <div className="h-64 flex items-center justify-center">
                    <div className="text-cream-20 text-sm font-body">
                      No stake history available.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-cream text-sm font-body font-medium uppercase tracking-wider">
                      Stake History
                    </h3>
                    <div className="flex items-center gap-4 text-xs font-body">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-[#a78bfa]" />
                        <span className="text-cream-40">Stake (MON)</span>
                      </div>
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={stakeChartData}>
                      <defs>
                        <linearGradient
                          id="stakeGrad"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#a78bfa"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="100%"
                            stopColor="#7c3aed"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(243,238,217,0.04)"
                      />
                      <XAxis
                        dataKey="epoch"
                        tick={{
                          fill: "rgba(243,238,217,0.3)",
                          fontSize: 11,
                        }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{
                          fill: "rgba(243,238,217,0.3)",
                          fontSize: 11,
                        }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => formatStake(val)}
                      />
                      <Tooltip content={<StakeTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="stakeMon"
                        stroke="#a78bfa"
                        strokeWidth={2}
                        fill="url(#stakeGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ScrollReveal>

            {/* ── Income Table ── */}
            <ScrollReveal delay={300}>
              {incomeLoading ? (
                <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
                  <div className="h-48 flex items-center justify-center">
                    <div className="text-cream-20 text-sm font-body animate-pulse">
                      Loading income data...
                    </div>
                  </div>
                </div>
              ) : incomeData.length === 0 ? (
                <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
                  <div className="h-48 flex items-center justify-center">
                    <div className="text-cream-20 text-sm font-body">
                      No income data available for this epoch range.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl overflow-hidden">
                  {/* Table header */}
                  <div className="flex items-center justify-between px-6 py-4 border-b border-cream-8">
                    <h3 className="text-cream text-sm font-body font-medium uppercase tracking-wider">
                      Epoch-by-Epoch Income
                    </h3>
                    <button
                      onClick={() => exportCsv(incomeData)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-body text-cream-40 bg-cream-8 hover:bg-cream-12 hover:text-cream-60 rounded-lg transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export CSV
                    </button>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-cream-8">
                          {(
                            [
                              {
                                key: "epoch" as SortKey,
                                label: "Epoch",
                                align: "left" as const,
                              },
                              {
                                key: "blockRewardsMon" as SortKey,
                                label: "Block Rewards",
                                align: "right" as const,
                              },
                              {
                                key: "commissionMon" as SortKey,
                                label: "Commission",
                                align: "right" as const,
                              },
                              {
                                key: "totalMon" as SortKey,
                                label: "Total (MON)",
                                align: "right" as const,
                              },
                              {
                                key: "totalUsd" as SortKey,
                                label: "Total (USD)",
                                align: "right" as const,
                              },
                            ] as const
                          ).map((col) => (
                            <th
                              key={col.key}
                              onClick={() => toggleSort(col.key)}
                              className={`px-6 py-3 text-xs font-body font-medium uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-cream-60 ${
                                col.align === "right"
                                  ? "text-right"
                                  : "text-left"
                              } ${
                                sortKey === col.key
                                  ? "text-cream-60"
                                  : "text-cream-20"
                              }`}
                            >
                              <span className="inline-flex items-center gap-1">
                                {col.label}
                                <ArrowUpDown className="w-3 h-3" />
                              </span>
                            </th>
                          ))}
                          <th className="px-6 py-3 text-xs font-body font-medium uppercase tracking-wider text-cream-20 text-right">
                            Date
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedIncome.map((row, i) => (
                          <tr
                            key={row.epoch}
                            className={`border-b border-cream-5 transition-colors hover:bg-cream-8 ${
                              i % 2 === 0 ? "bg-transparent" : "bg-cream-3"
                            }`}
                          >
                            <td className="px-6 py-3 text-sm font-mono text-cream-60">
                              {row.epoch}
                            </td>
                            <td className="px-6 py-3 text-sm font-mono text-cream-40 text-right">
                              {formatMon(row.blockRewardsMon)}
                            </td>
                            <td className="px-6 py-3 text-sm font-mono text-cream-40 text-right">
                              {formatMon(row.commissionMon)}
                            </td>
                            <td className="px-6 py-3 text-sm font-mono text-phase-green text-right font-medium">
                              {formatMon(row.totalMon)}
                            </td>
                            <td className="px-6 py-3 text-sm font-mono text-cream-40 text-right">
                              {row.totalUsd > 0
                                ? formatUsd(row.totalUsd)
                                : "\u2014"}
                            </td>
                            <td className="px-6 py-3 text-sm font-mono text-cream-20 text-right">
                              {new Date(row.timestamp).toLocaleDateString(
                                "en-US",
                                {
                                  month: "short",
                                  day: "numeric",
                                }
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Table footer summary */}
                  <div className="flex items-center justify-between px-6 py-3 border-t border-cream-8 bg-cream-3">
                    <span className="text-cream-20 text-xs font-body">
                      {incomeData.length} epochs
                    </span>
                    <span className="text-cream-40 text-xs font-mono">
                      Total:{" "}
                      <span className="text-phase-green font-medium">
                        {formatMon(
                          incomeData.reduce((s, d) => s + d.totalMon, 0)
                        )}{" "}
                        MON
                      </span>
                    </span>
                  </div>
                </div>
              )}
            </ScrollReveal>
          </>
        )}

        <Footer />
      </div>
    </div>
  );
}
