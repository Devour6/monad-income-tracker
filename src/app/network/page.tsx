"use client";

import { useState, useEffect } from "react";
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
  Layers,
  Users,
  TrendingUp,
  DollarSign,
  Percent,
  Activity,
} from "lucide-react";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";
import { ScrollReveal } from "@/components/scroll-reveal";
import { formatMon, formatUsd, formatApy } from "@/lib/apy";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface NetworkOverview {
  totalStakeMon: number;
  totalStakeUsd: number;
  activeValidators: number;
  avgCommissionPct: number;
  networkApy: number;
  monPriceUsd: number;
  latestEpoch: number;
  epochSpan: number;
  updatedAt: string | null;
}

interface HistoryRow {
  epoch: number;
  totalStakeMon: number;
  activeValidators: number;
  monPriceUsd: number;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`bg-cream-5 rounded animate-pulse ${className}`}
    />
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatPrice(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

function formatStakeCompact(mon: number): string {
  if (mon >= 1_000_000_000) return `${(mon / 1_000_000_000).toFixed(1)}B`;
  if (mon >= 1_000_000) return `${(mon / 1_000_000).toFixed(1)}M`;
  if (mon >= 1_000) return `${(mon / 1_000).toFixed(1)}K`;
  return mon.toFixed(0);
}

/* ------------------------------------------------------------------ */
/*  Chart Tooltips                                                     */
/* ------------------------------------------------------------------ */

function StakeTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: HistoryRow }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;

  return (
    <div className="bg-dark border border-cream-12 rounded-lg px-3 py-2 shadow-xl">
      <div className="text-cream text-xs font-body font-medium mb-1">
        Epoch {d.epoch}
      </div>
      <div className="text-phase-green text-xs">
        {formatMon(d.totalStakeMon)} MON
      </div>
      <div className="text-cream-20 text-xs mt-0.5">
        {formatDate(d.createdAt)}
      </div>
    </div>
  );
}

function PriceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: HistoryRow }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;

  return (
    <div className="bg-dark border border-cream-12 rounded-lg px-3 py-2 shadow-xl">
      <div className="text-cream text-xs font-body font-medium mb-1">
        Epoch {d.epoch}
      </div>
      <div className="text-phase-green text-xs">
        {formatPrice(d.monPriceUsd)}
      </div>
      <div className="text-cream-20 text-xs mt-0.5">
        {formatDate(d.createdAt)}
      </div>
    </div>
  );
}

function ValidatorTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: HistoryRow }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;

  return (
    <div className="bg-dark border border-cream-12 rounded-lg px-3 py-2 shadow-xl">
      <div className="text-cream text-xs font-body font-medium mb-1">
        Epoch {d.epoch}
      </div>
      <div className="text-phase-green text-xs">
        {d.activeValidators} validators
      </div>
      <div className="text-cream-20 text-xs mt-0.5">
        {formatDate(d.createdAt)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function NetworkDashboard() {
  const [overview, setOverview] = useState<NetworkOverview | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const [overviewRes, historyRes] = await Promise.all([
          fetch("/api/network/overview"),
          fetch("/api/network/history?limit=90"),
        ]);

        if (!overviewRes.ok) {
          const err = await overviewRes.json().catch(() => ({}));
          throw new Error(
            err.error || `Overview request failed (${overviewRes.status})`
          );
        }

        const overviewData = await overviewRes.json();
        setOverview(overviewData);

        if (historyRes.ok) {
          const historyData = await historyRes.json();
          setHistory(historyData.history || []);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load network data"
        );
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // Reverse history for chronological display (API returns newest-first)
  const chartData = [...history].reverse();

  const statsCards = overview
    ? [
        {
          label: "Total Stake",
          value: formatMon(overview.totalStakeMon),
          unit: "MON",
          sublabel: formatUsd(overview.totalStakeUsd) || "---",
          icon: Layers,
        },
        {
          label: "Active Validators",
          value: String(overview.activeValidators),
          unit: "",
          sublabel: `Epoch ${overview.latestEpoch.toLocaleString()}`,
          icon: Users,
        },
        {
          label: "Network APY",
          value: formatApy(overview.networkApy),
          unit: "",
          sublabel: `Across ${overview.epochSpan}-epoch span`,
          icon: TrendingUp,
        },
        {
          label: "MON Price",
          value: formatPrice(overview.monPriceUsd),
          unit: "",
          sublabel: "USD",
          icon: DollarSign,
        },
        {
          label: "Avg Commission",
          value: `${overview.avgCommissionPct}%`,
          unit: "",
          sublabel: "Across all validators",
          icon: Percent,
        },
        {
          label: "Latest Epoch",
          value: overview.latestEpoch.toLocaleString(),
          unit: "",
          sublabel: overview.updatedAt
            ? new Date(overview.updatedAt).toLocaleString()
            : "---",
          icon: Activity,
        },
      ]
    : [];

  return (
    <div className="relative z-[1] px-6 pt-8 pb-6">
      <AuroraBg />
      <FloatingParticles />
      <div className="max-w-[1340px] mx-auto">
        {/* Navigation */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-cream-40 text-sm font-body hover:text-cream transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Income Tracker
        </Link>

        {/* Header */}
        <header
          className="text-center mb-10 pb-7 border-b border-cream-8 opacity-0 animate-fade-in-up"
          style={{ animationDelay: "0.08s" }}
        >
          <h1 className="font-display text-[32px] font-normal mb-2 text-cream tracking-[0.03em]">
            Network Overview
          </h1>
          <p className="font-body text-cream-40 text-[15px] font-light">
            Monad network statistics &mdash; stake, validators, and price
            history
          </p>
          {overview && (
            <div className="mt-3 inline-flex items-center gap-2 bg-cream-5 border border-cream-8 rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-phase-green animate-pulse" />
              <span className="text-cream-40 text-xs font-body">
                Epoch {overview.latestEpoch.toLocaleString()}
              </span>
            </div>
          )}
        </header>

        {/* Error State */}
        {error && (
          <div className="text-center py-20">
            <div className="inline-flex flex-col items-center gap-4 bg-cream-5 border border-cream-8 rounded-2xl px-8 py-6">
              <div className="text-cream-60 text-sm font-body">
                {error}
              </div>
              <button
                onClick={() => window.location.reload()}
                className="text-cream text-xs font-body bg-cream-8 hover:bg-cream-12 px-4 py-1.5 rounded-full transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && !error && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-cream-5 border border-cream-8 rounded-xl p-4"
                >
                  <Skeleton className="h-4 w-20 mb-3" />
                  <Skeleton className="h-8 w-28 mb-2" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
            <div className="bg-cream-5 border border-cream-8 rounded-xl p-6">
              <Skeleton className="h-4 w-40 mb-4" />
              <Skeleton className="h-[280px] w-full" />
            </div>
          </div>
        )}

        {/* Loaded Content */}
        {!loading && !error && overview && (
          <>
            {/* Stats Cards Grid */}
            <ScrollReveal delay={0}>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {statsCards.map((card) => (
                  <div
                    key={card.label}
                    className="bg-cream-5 border border-cream-8 rounded-xl p-4 card-hover"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <card.icon className="w-4 h-4 text-cream-40" />
                      <span className="text-cream-40 text-xs font-body uppercase tracking-wider">
                        {card.label}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-cream text-2xl font-body font-semibold stat-shimmer">
                        {card.value}
                      </span>
                      {card.unit && (
                        <span className="text-cream-40 text-xs font-body">
                          {card.unit}
                        </span>
                      )}
                    </div>
                    <div className="text-cream-20 text-xs font-body mt-1">
                      {card.sublabel}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollReveal>

            {/* Total Stake Chart */}
            {chartData.length > 0 && (
              <ScrollReveal delay={100}>
                <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-cream text-sm font-body font-medium uppercase tracking-wider">
                      Total Stake Over Time
                    </h3>
                    <div className="flex items-center gap-1.5 text-xs font-body">
                      <div className="w-2.5 h-2.5 rounded-full bg-phase-green" />
                      <span className="text-cream-40">Total Stake (MON)</span>
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData}>
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
                        tickFormatter={(v) => formatStakeCompact(v)}
                      />
                      <Tooltip content={<StakeTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="totalStakeMon"
                        stroke="#4ade80"
                        strokeWidth={2}
                        fill="url(#stakeGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </ScrollReveal>
            )}

            {/* MON Price Chart */}
            {chartData.length > 0 && (
              <ScrollReveal delay={200}>
                <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-cream text-sm font-body font-medium uppercase tracking-wider">
                      MON Price History
                    </h3>
                    <div className="flex items-center gap-1.5 text-xs font-body">
                      <div className="w-2.5 h-2.5 rounded-full bg-phase-yellow" />
                      <span className="text-cream-40">Price (USD)</span>
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient
                          id="priceGrad"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#facc15"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="100%"
                            stopColor="#facc15"
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
                        tickFormatter={(v) => `$${v}`}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip content={<PriceTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="monPriceUsd"
                        stroke="#facc15"
                        strokeWidth={2}
                        fill="url(#priceGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </ScrollReveal>
            )}

            {/* Active Validators Chart */}
            {chartData.length > 0 && (
              <ScrollReveal delay={300}>
                <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-cream text-sm font-body font-medium uppercase tracking-wider">
                      Active Validators Over Time
                    </h3>
                    <div className="flex items-center gap-1.5 text-xs font-body">
                      <div className="w-2.5 h-2.5 rounded-full bg-cream-60" />
                      <span className="text-cream-40">Validators</span>
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient
                          id="validatorGrad"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#F3EED9"
                            stopOpacity={0.2}
                          />
                          <stop
                            offset="100%"
                            stopColor="#F3EED9"
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
                        allowDecimals={false}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip content={<ValidatorTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="activeValidators"
                        stroke="rgba(243,238,217,0.6)"
                        strokeWidth={2}
                        fill="url(#validatorGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </ScrollReveal>
            )}

            {/* Empty history state */}
            {chartData.length === 0 && (
              <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
                <div className="h-64 flex items-center justify-center">
                  <div className="text-cream-20 text-sm font-body">
                    No historical data yet. History will appear after multiple
                    snapshot epochs are recorded.
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <Footer />
      </div>
    </div>
  );
}
