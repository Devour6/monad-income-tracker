"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Activity,
  GitCompareArrows,
  ExternalLink,
  BookOpen,
  Coins,
  Scale,
  TrendingUp,
  Zap,
  FileText,
  Bell,
  Code2,
  ArrowRight,
  Search,
} from "lucide-react";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";
import { ValidatorSearch } from "@/components/income/validator-search";
import { IncomeSummary } from "@/components/income/income-summary";
import { IncomeChart } from "@/components/income/income-chart";
import { IncomeTable } from "@/components/income/income-table";
import { ScrollReveal } from "@/components/scroll-reveal";

interface ValidatorListItem {
  validatorId: number;
  name: string;
  authAddress: string;
  stakeMon: number;
  commissionPct: number;
  lastEpoch: number;
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

interface IncomeSummaryData {
  observed: {
    epochCount: number;
    snapshotCount: number;
    daysObserved: number;
    poolRewardsMon: number;
    poolRewardsUsd: number;
    commissionMon: number;
    commissionUsd: number;
    delegatorRewardsMon: number;
    firstEpoch: number | null;
    lastEpoch: number | null;
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
    commissionPerDayUsd: number;
    commissionPerMonthUsd: number;
    commissionPerYearUsd: number;
    poolPerDayUsd: number;
    poolPerMonthUsd: number;
    poolPerYearUsd: number;
  };
  latestMonPriceUsd: number;
}

interface NetworkOverview {
  totalStakeMon: number;
  totalStakeUsd: number;
  activeValidators: number | string;
  avgCommissionPct: number;
  networkApy: number;
  networkPriorityFeesMon: number | null;
  networkPriorityFeesUsd: number | null;
  monPriceUsd: number;
  latestEpoch: number;
}

interface LivePrice {
  monPriceUsd: number;
  source: string;
  asOf: string;
}

function formatCompactUsd(n: number): string {
  if (!isFinite(n) || n <= 0) return "$0";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatCompactMon(n: number): string {
  if (!isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatPrice(n: number): string {
  if (!isFinite(n) || n <= 0) return "—";
  return `$${n.toFixed(4)}`;
}

const QUICK_ACTIONS = [
  {
    href: "/stake",
    icon: Coins,
    title: "Choose a Validator",
    desc: "Browse the leaderboard and pick the best validator to delegate to.",
    accent: true,
  },
  {
    href: "/network",
    icon: Activity,
    title: "Network Overview",
    desc: "Live network stats: stake, validators, APY, MEV throughput.",
  },
  {
    href: "/compare",
    icon: GitCompareArrows,
    title: "Compare Validators",
    desc: "Stack multiple validators side-by-side across every metric.",
  },
  {
    href: "/simulate",
    icon: TrendingUp,
    title: "Income Simulator",
    desc: "Model delegation income with historical variance bands.",
  },
  {
    href: "/reports",
    icon: FileText,
    title: "Income Reports",
    desc: "PDF/CSV exports with FX toggle, server cost, custom date range.",
  },
  {
    href: "/mev",
    icon: Zap,
    title: "MEV Analytics",
    desc: "Real per-block priority fees by validator and epoch.",
  },
  {
    href: "/alerts",
    icon: Bell,
    title: "Alerts",
    desc: "Webhook notifications when commission or APY change.",
  },
  {
    href: "/sdk",
    icon: Code2,
    title: "API & SDK",
    desc: "Free public API. Copy-paste cURL, JS, and Python snippets.",
  },
];

export default function Home() {
  const [validators, setValidators] = useState<ValidatorListItem[]>([]);
  const [selectedValidator, setSelectedValidator] =
    useState<ValidatorListItem | null>(null);
  const [incomeData, setIncomeData] = useState<EpochIncome[]>([]);
  const [summary, setSummary] = useState<IncomeSummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [epochCount, setEpochCount] = useState(30);
  const [dbReady, setDbReady] = useState(true);
  const [overview, setOverview] = useState<NetworkOverview | null>(null);
  const [livePrice, setLivePrice] = useState<LivePrice | null>(null);

  // Validator list
  useEffect(() => {
    fetch("/api/validators")
      .then((r) => r.json())
      .then((data) => {
        if (data.validators) setValidators(data.validators);
      })
      .catch(() => setDbReady(false));
  }, []);

  // Network overview (one-shot)
  useEffect(() => {
    fetch("/api/network/overview")
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setOverview(d as NetworkOverview);
      })
      .catch(() => {});
  }, []);

  // Live MON price — refreshes every 30s
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetch("/api/v1/price")
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d?.monPriceUsd) setLivePrice(d as LivePrice);
        })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const fetchIncome = useCallback(
    async (validatorId: number, epochs: number) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/validators/${validatorId}/income?epochs=${epochs}`
        );
        const data = await res.json();
        setIncomeData(data.epochs || []);
        setSummary(data.summary || null);
      } catch {
        setIncomeData([]);
        setSummary(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (selectedValidator) {
      fetchIncome(selectedValidator.validatorId, epochCount);
    }
  }, [selectedValidator, epochCount, fetchIncome]);

  // Top 5 validators by stake for the highlight strip
  const topValidators = useMemo(() => {
    return [...validators]
      .sort((a, b) => b.stakeMon - a.stakeMon)
      .slice(0, 5);
  }, [validators]);

  const monPrice = livePrice?.monPriceUsd ?? overview?.monPriceUsd ?? 0;

  return (
    <div className="relative z-[1] px-6 pt-6 pb-6">
      <AuroraBg />
      <FloatingParticles />

      <div className="max-w-[1340px] mx-auto">
        {/* ───────────────────────── HERO ───────────────────────── */}
        <header
          className="relative pt-8 pb-12 opacity-0 animate-fade-in-up"
          style={{ animationDelay: "0.05s" }}
        >
          {/* Live status pill */}
          <div className="flex items-center justify-center mb-6">
            <div className="inline-flex items-center gap-2 bg-cream-5 border border-cream-8 rounded-full px-3 py-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-phase-green opacity-75 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-phase-green" />
              </span>
              <span className="text-cream-60 text-[10px] font-body uppercase tracking-[0.18em]">
                Live · {validators.length || "—"} validators · epoch{" "}
                {overview?.latestEpoch ?? "—"}
              </span>
            </div>
          </div>

          {/* Title */}
          <h1 className="font-display text-center text-[44px] sm:text-[60px] leading-[1.05] tracking-[0.02em] text-cream">
            Monad Income{" "}
            <span className="relative inline-block">
              <span className="bg-gradient-to-r from-phase-green via-cream to-phase-green bg-[length:200%_100%] animate-shimmer bg-clip-text text-transparent">
                Tracker
              </span>
            </span>
          </h1>
          <p className="mt-4 text-center font-body text-cream-60 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            Real validator income on Monad — block rewards, commission,
            self-stake yield, and MEV — measured per epoch, on chain.
          </p>

          {/* Live stat strip */}
          <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-4xl mx-auto">
            <StatTile
              label="MON Price"
              value={formatPrice(monPrice)}
              hint={livePrice?.source ? `via ${livePrice.source}` : "live"}
              live
            />
            <StatTile
              label="Total Staked"
              value={
                overview
                  ? formatCompactUsd(overview.totalStakeUsd)
                  : "—"
              }
              hint={
                overview
                  ? `${formatCompactMon(overview.totalStakeMon)} MON`
                  : "loading"
              }
            />
            <StatTile
              label="Network APY"
              value={
                overview ? `${overview.networkApy.toFixed(2)}%` : "—"
              }
              hint="pool yield"
            />
            <StatTile
              label="Avg Commission"
              value={
                overview ? `${overview.avgCommissionPct.toFixed(1)}%` : "—"
              }
              hint={`${overview?.activeValidators ?? "—"} active`}
            />
          </div>

          {/* Big primary CTA */}
          <div className="mt-10 flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/stake"
              className="group inline-flex items-center gap-2 px-5 py-2.5 text-sm font-body font-medium text-dark bg-phase-green rounded-lg hover:bg-phase-green/90 transition-all shadow-[0_0_20px_-4px_rgba(74,222,128,0.6)]"
            >
              <Coins className="w-4 h-4" />
              Browse Validators
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/network"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-body text-cream-60 bg-cream-5 border border-cream-8 rounded-lg hover:bg-cream-8 hover:text-cream transition-all"
            >
              <Activity className="w-4 h-4" />
              Network Overview
            </Link>
          </div>
        </header>

        {/* ─────────────────────── SEARCH ─────────────────────── */}
        {!dbReady ? (
          <div className="text-center py-20">
            <div className="inline-flex flex-col items-center gap-4 bg-cream-5 border border-cream-8 rounded-2xl px-8 py-6">
              <div className="text-cream-60 text-sm font-body">
                Database not connected. Set{" "}
                <code className="font-mono text-cream bg-cream-8 px-1.5 py-0.5 rounded">
                  DATABASE_URL
                </code>{" "}
                and run the snapshot cron to start collecting data.
              </div>
            </div>
          </div>
        ) : (
          <>
            <ScrollReveal delay={0}>
              <div className="relative max-w-3xl mx-auto">
                <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-phase-green/0 via-phase-green/20 to-phase-green/0 opacity-60 blur-md pointer-events-none" />
                <div className="relative rounded-2xl border border-cream-12 bg-cream-5/80 backdrop-blur-sm p-1.5 z-20">
                  <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                    <Search className="w-3.5 h-3.5 text-cream-40" />
                    <span className="text-[10px] uppercase tracking-[0.18em] font-body text-cream-40">
                      Search any validator
                    </span>
                  </div>
                  <ValidatorSearch
                    validators={validators}
                    selected={selectedValidator}
                    onSelect={(v: ValidatorListItem) =>
                      setSelectedValidator(v)
                    }
                  />
                </div>
              </div>
            </ScrollReveal>

            {/* Top 5 highlight strip — shown only when no selection */}
            {!selectedValidator && topValidators.length > 0 && (
              <ScrollReveal delay={100}>
                <div className="mt-6 max-w-3xl mx-auto">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] font-body text-cream-40">
                      Top by stake
                    </span>
                    <Link
                      href="/stake"
                      className="text-[10px] uppercase tracking-[0.18em] font-body text-cream-40 hover:text-phase-green transition-colors"
                    >
                      View all →
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {topValidators.map((v, i) => (
                      <button
                        key={v.validatorId}
                        onClick={() => setSelectedValidator(v)}
                        className="group text-left rounded-xl border border-cream-8 bg-cream-5 hover:bg-cream-8 hover:border-cream-20 transition-all px-3 py-2.5"
                      >
                        <div className="flex items-baseline justify-between mb-1">
                          <span className="text-[9px] font-mono text-cream-40">
                            #{i + 1}
                          </span>
                          <span className="text-[9px] font-mono text-cream-40">
                            {v.commissionPct}% fee
                          </span>
                        </div>
                        <div className="text-[13px] font-body text-cream truncate group-hover:text-phase-green transition-colors">
                          {v.name}
                        </div>
                        <div className="text-[10px] font-mono text-cream-40 mt-0.5">
                          {formatCompactMon(v.stakeMon)} MON
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </ScrollReveal>
            )}

            {/* ─────────────── SELECTED VALIDATOR DETAIL ─────────────── */}
            {selectedValidator && (
              <>
                <div className="flex items-center justify-between mt-8 mb-2">
                  <Link
                    href={`/validators/${selectedValidator.validatorId}`}
                    className="inline-flex items-center gap-1.5 text-cream-40 text-xs font-body hover:text-phase-green transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Full validator detail
                  </Link>
                  <div className="flex items-center gap-2">
                    <span className="text-cream-40 text-xs font-body">
                      Showing
                    </span>
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
                </div>

                <ScrollReveal delay={100}>
                  <IncomeSummary
                    summary={summary}
                    validator={selectedValidator}
                    loading={loading}
                  />
                </ScrollReveal>
                <ScrollReveal delay={200}>
                  <IncomeChart data={incomeData} loading={loading} />
                </ScrollReveal>
                <ScrollReveal delay={300}>
                  <IncomeTable data={incomeData} loading={loading} />
                </ScrollReveal>
              </>
            )}

            {/* ─────────────── QUICK ACTIONS ─────────────── */}
            {!selectedValidator && (
              <ScrollReveal delay={150}>
                <section className="mt-16">
                  <div className="flex items-baseline justify-between mb-4">
                    <h2 className="font-display text-lg text-cream tracking-wide">
                      Everything in one place
                    </h2>
                    <span className="text-[10px] uppercase tracking-[0.18em] font-body text-cream-40">
                      8 tools · 1 dataset
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {QUICK_ACTIONS.map((a) => (
                      <Link
                        key={a.href}
                        href={a.href}
                        className={`group relative rounded-xl border p-4 transition-all ${
                          a.accent
                            ? "border-phase-green/30 bg-phase-green/5 hover:bg-phase-green/10 hover:border-phase-green/50"
                            : "border-cream-8 bg-cream-5 hover:bg-cream-8 hover:border-cream-20"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2.5">
                          <div
                            className={`p-1.5 rounded-lg ${
                              a.accent
                                ? "bg-phase-green/15 text-phase-green"
                                : "bg-cream-8 text-cream-60 group-hover:text-cream"
                            }`}
                          >
                            <a.icon className="w-4 h-4" />
                          </div>
                          <ArrowRight
                            className={`w-3.5 h-3.5 transition-all ${
                              a.accent
                                ? "text-phase-green/60 group-hover:text-phase-green group-hover:translate-x-0.5"
                                : "text-cream-20 group-hover:text-cream-60 group-hover:translate-x-0.5"
                            }`}
                          />
                        </div>
                        <div
                          className={`text-sm font-body font-medium ${
                            a.accent ? "text-phase-green" : "text-cream"
                          }`}
                        >
                          {a.title}
                        </div>
                        <div className="text-[11px] font-body text-cream-40 mt-1 leading-relaxed">
                          {a.desc}
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              </ScrollReveal>
            )}

            {/* Below-fold: trust strip */}
            {!selectedValidator && (
              <ScrollReveal delay={250}>
                <section className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <TrustCell
                    title="On-chain truth"
                    body="Every number sourced from the staking precompile and block-by-block indexing."
                    href="/methodology"
                    cta="Methodology"
                  />
                  <TrustCell
                    title="Free public API"
                    body="Versioned endpoints, OpenAPI spec, 60 req/min unauthenticated, 600 with a key."
                    href="/sdk"
                    cta="SDK & Docs"
                  />
                  <TrustCell
                    title="Open source"
                    body="github.com/Devour6/monad-income-tracker — audit it, fork it, file issues."
                    href="https://github.com/Devour6/monad-income-tracker"
                    cta="GitHub"
                    external
                  />
                </section>
              </ScrollReveal>
            )}
          </>
        )}

        <Footer />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components — single-file to avoid pulling in new component files

function StatTile({
  label,
  value,
  hint,
  live,
}: {
  label: string;
  value: string;
  hint?: string;
  live?: boolean;
}) {
  return (
    <div className="relative rounded-xl border border-cream-8 bg-cream-5 px-4 py-3 overflow-hidden">
      {live && (
        <span className="absolute top-2.5 right-2.5 flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-phase-green opacity-60 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-phase-green" />
        </span>
      )}
      <div className="text-[9px] uppercase tracking-[0.18em] font-body text-cream-40">
        {label}
      </div>
      <div className="mt-1 font-display text-xl text-cream tracking-wide">
        {value}
      </div>
      {hint && (
        <div className="text-[10px] font-mono text-cream-40 mt-0.5">
          {hint}
        </div>
      )}
    </div>
  );
}

function TrustCell({
  title,
  body,
  href,
  cta,
  external,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
  external?: boolean;
}) {
  const inner = (
    <div className="group rounded-xl border border-cream-8 bg-cream-5 hover:bg-cream-8 hover:border-cream-20 transition-all px-4 py-4 h-full">
      <div className="text-sm font-body font-medium text-cream">{title}</div>
      <div className="text-[12px] font-body text-cream-40 mt-1 leading-relaxed">
        {body}
      </div>
      <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-body text-cream-60 group-hover:text-phase-green transition-colors">
        {cta} <ArrowRight className="w-3 h-3" />
      </div>
    </div>
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  }
  return <Link href={href}>{inner}</Link>;
}
