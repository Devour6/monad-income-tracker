"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Activity,
  GitCompareArrows,
  TrendingUp,
  FileText,
  Bell,
  Code2,
  ArrowRight,
  Coins,
  ExternalLink,
} from "lucide-react";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";
import { ValidatorSearch } from "@/components/income/validator-search";
import { IncomeChart } from "@/components/income/income-chart";

interface ValidatorListItem {
  validatorId: number;
  name: string;
  authAddress: string;
  stakeMon: number;
  commissionPct: number;
  lastEpoch: number;
}

interface RealizedIncome {
  validatorId: number;
  name: string;
  firstEpoch: number;
  lastEpoch: number;
  daysObserved: number;
  totalCommissionMon: number;
  totalCommissionUsd: number;
  currentUnclaimedMon: number;
  currentUnclaimedUsd: number;
  totalClaimedMon: number;
  totalClaimedUsd: number;
  monPriceUsd: number;
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

interface NetworkOverview {
  totalStakeMon: number;
  totalStakeUsd: number;
  activeValidators: number | string;
  avgCommissionPct: number;
  networkApy: number;
  monPriceUsd: number;
  latestEpoch: number;
}

interface LivePrice {
  monPriceUsd: number;
  source: string;
}

function fmtUsd(n: number): string {
  if (!isFinite(n) || n <= 0) return "$0";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtMon(n: number): string {
  if (!isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function fmtPrice(n: number): string {
  if (!isFinite(n) || n <= 0) return "—";
  return `$${n.toFixed(4)}`;
}

const QUICK_LINKS: Array<{
  href: string;
  label: string;
  desc: string;
  Icon: typeof Activity;
}> = [
  {
    href: "/stake",
    label: "All validators",
    desc: "Sortable leaderboard",
    Icon: Coins,
  },
  {
    href: "/network",
    label: "Network overview",
    desc: "Aggregate stats",
    Icon: Activity,
  },
  {
    href: "/compare",
    label: "Compare",
    desc: "Side-by-side",
    Icon: GitCompareArrows,
  },
  {
    href: "/simulate",
    label: "Simulate",
    desc: "Project delegator returns",
    Icon: TrendingUp,
  },
  {
    href: "/reports",
    label: "Reports",
    desc: "CSV / PDF income",
    Icon: FileText,
  },
  {
    href: "/alerts",
    label: "Alerts",
    desc: "Webhook notifications",
    Icon: Bell,
  },
];

export default function Home() {
  const [validators, setValidators] = useState<ValidatorListItem[]>([]);
  const [selected, setSelected] = useState<ValidatorListItem | null>(null);
  const [realized, setRealized] = useState<RealizedIncome | null>(null);
  const [epochHistory, setEpochHistory] = useState<EpochIncome[]>([]);
  const [overview, setOverview] = useState<NetworkOverview | null>(null);
  const [livePrice, setLivePrice] = useState<LivePrice | null>(null);
  const [loading, setLoading] = useState(false);
  const [dbReady, setDbReady] = useState(true);

  // Validator list
  useEffect(() => {
    fetch("/api/validators")
      .then((r) => r.json())
      .then((d) => {
        if (d.validators) setValidators(d.validators);
      })
      .catch(() => setDbReady(false));
  }, []);

  // Network overview
  useEffect(() => {
    fetch("/api/network/overview")
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setOverview(d);
      })
      .catch(() => {});
  }, []);

  // Live MON price (refresh every 30s)
  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch("/api/v1/price")
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled && !d.error) setLivePrice(d);
        })
        .catch(() => {});
    }
    load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Fetch realized income + epoch chart history when a validator is picked
  const fetchValidator = useCallback(async (id: number) => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/v1/validators/${id}/realized`).then((r) => r.json()),
        fetch(`/api/validators/${id}/income?epochs=60`).then((r) => r.json()),
      ]);
      if (!r1.error) setRealized(r1);
      else setRealized(null);
      setEpochHistory(r2.epochs || []);
    } catch {
      setRealized(null);
      setEpochHistory([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) fetchValidator(selected.validatorId);
  }, [selected, fetchValidator]);

  const monPrice = livePrice?.monPriceUsd ?? overview?.monPriceUsd ?? 0;

  return (
    <div className="relative z-[1] min-h-screen px-6 pt-10 pb-6">
      <AuroraBg />
      <FloatingParticles />

      <div className="max-w-[1100px] mx-auto">
        {/* Top bar — minimal, just title + live price + nav links */}
        <header className="flex items-center justify-between mb-12 opacity-0 animate-fade-in-up">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-xl text-cream tracking-[0.04em]">
              Monad Income Tracker
            </h1>
            {overview?.activeValidators ? (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-body uppercase tracking-widest text-cream-40 bg-cream-5 border border-cream-8 rounded-full px-2.5 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-phase-green animate-pulse" />
                {overview.activeValidators} validators · epoch {overview.latestEpoch}
              </span>
            ) : null}
          </div>
          <nav className="flex items-center gap-1">
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

        {/* Hero — clean centered headline + price tile */}
        <section
          className="text-center mb-10 opacity-0 animate-fade-in-up"
          style={{ animationDelay: "0.08s" }}
        >
          <h2 className="font-display text-[40px] sm:text-[52px] leading-[1.05] text-cream tracking-[0.02em] mb-4">
            Validator income
            <br />
            <span className="text-phase-green">measured, not estimated</span>
          </h2>
          <p className="font-body text-cream-60 text-[15px] max-w-xl mx-auto leading-relaxed">
            Lifetime commission, claims, and unclaimed rewards — pulled directly
            from the Monad staking precompile. Open data for every validator.
          </p>

          {/* Live tile row — only 3 numbers, calm */}
          <div className="mt-8 inline-flex items-center gap-6 sm:gap-10 px-6 py-3 rounded-xl border border-cream-8 bg-cream-5">
            <div className="text-left">
              <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-phase-green animate-pulse" />
                MON
              </div>
              <div className="font-mono text-cream text-base mt-0.5">
                {fmtPrice(monPrice)}
              </div>
            </div>
            <div className="w-px h-8 bg-cream-8" />
            <div className="text-left">
              <div className="text-[10px] font-body uppercase tracking-widest text-cream-40">
                Total staked
              </div>
              <div className="font-mono text-cream text-base mt-0.5">
                {overview ? fmtUsd(overview.totalStakeUsd) : "—"}
              </div>
            </div>
            <div className="w-px h-8 bg-cream-8" />
            <div className="text-left">
              <div className="text-[10px] font-body uppercase tracking-widest text-cream-40">
                Avg APY
              </div>
              <div className="font-mono text-cream text-base mt-0.5">
                {overview ? `${overview.networkApy.toFixed(2)}%` : "—"}
              </div>
            </div>
          </div>
        </section>

        {!dbReady ? (
          <div className="text-center py-20 text-cream-60 font-body text-sm">
            Database is warming up. Refresh in a moment.
          </div>
        ) : (
          <>
            {/* Search — single row, max-width contained */}
            <section
              className="max-w-2xl mx-auto mb-10 opacity-0 animate-fade-in-up"
              style={{ animationDelay: "0.16s" }}
            >
              <ValidatorSearch
                validators={validators}
                selected={selected}
                onSelect={setSelected}
              />
            </section>

            {/* Selected validator — focus on REALIZED commission */}
            {selected && (
              <section className="mb-12 animate-fade-in">
                <div className="rounded-2xl border border-cream-12 bg-cream-5 p-6 sm:p-8">
                  {/* Heading row */}
                  <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2.5 mb-1">
                        <h3 className="font-display text-2xl text-cream tracking-wide">
                          {selected.name}
                        </h3>
                        <span className="text-cream-40 text-xs font-mono px-2 py-0.5 rounded border border-cream-12">
                          #{selected.validatorId}
                        </span>
                      </div>
                      <a
                        href={`https://testnet.monadexplorer.com/address/${selected.authAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cream-40 text-xs font-mono hover:text-cream-60 transition-colors inline-flex items-center gap-1"
                      >
                        {selected.authAddress.slice(0, 10)}…
                        {selected.authAddress.slice(-8)}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <Link
                      href={`/validators/${selected.validatorId}`}
                      className="inline-flex items-center gap-1.5 text-xs font-body text-phase-green bg-phase-green/10 border border-phase-green/30 rounded-lg px-3 py-1.5 hover:bg-phase-green/15 transition-colors"
                    >
                      Full dashboard
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>

                  {loading && !realized ? (
                    <div className="py-12 text-center text-cream-40 text-sm font-body">
                      Loading lifetime income…
                    </div>
                  ) : realized ? (
                    <>
                      {/* Headline number — REALIZED lifetime commission */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                        <div className="rounded-xl border border-phase-green/30 bg-phase-green/5 p-5">
                          <div className="text-[10px] font-body uppercase tracking-widest text-phase-green mb-1.5">
                            Lifetime commission
                          </div>
                          <div className="font-display text-3xl text-cream tracking-wide">
                            {fmtMon(realized.totalCommissionMon)}
                            <span className="text-cream-40 text-base font-body ml-1.5">
                              MON
                            </span>
                          </div>
                          <div className="text-cream-60 text-xs font-mono mt-1">
                            {fmtUsd(realized.totalCommissionMon * monPrice)} ·{" "}
                            {realized.daysObserved.toFixed(1)} days
                          </div>
                        </div>
                        <div className="rounded-xl border border-cream-12 bg-cream-5 p-5">
                          <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 mb-1.5">
                            Already claimed
                          </div>
                          <div className="font-display text-2xl text-cream tracking-wide">
                            {fmtMon(realized.totalClaimedMon)}
                            <span className="text-cream-40 text-sm font-body ml-1.5">
                              MON
                            </span>
                          </div>
                          <div className="text-cream-60 text-xs font-mono mt-1">
                            {fmtUsd(realized.totalClaimedMon * monPrice)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-cream-12 bg-cream-5 p-5">
                          <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 mb-1.5">
                            Unclaimed (pending)
                          </div>
                          <div className="font-display text-2xl text-cream tracking-wide">
                            {fmtMon(realized.currentUnclaimedMon)}
                            <span className="text-cream-40 text-sm font-body ml-1.5">
                              MON
                            </span>
                          </div>
                          <div className="text-cream-60 text-xs font-mono mt-1">
                            {fmtUsd(realized.currentUnclaimedMon * monPrice)}
                          </div>
                        </div>
                      </div>

                      {/* Per-epoch chart */}
                      {epochHistory.length > 0 && (
                        <div className="rounded-xl border border-cream-8 bg-dark p-4">
                          <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 mb-2">
                            Per-epoch commission · last {epochHistory.length}{" "}
                            epochs
                          </div>
                          <IncomeChart data={epochHistory} loading={loading} />
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="py-12 text-center text-cream-40 text-sm font-body">
                      No realized income data yet for this validator.
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Quick links — small, calm grid */}
            <section
              className="mb-12 opacity-0 animate-fade-in-up"
              style={{ animationDelay: "0.24s" }}
            >
              <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 mb-3 text-center">
                Explore
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {QUICK_LINKS.map(({ href, label, desc, Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className="group flex items-center gap-3 rounded-lg border border-cream-8 bg-cream-5 px-4 py-3 hover:border-cream-20 hover:bg-cream-8 transition-colors"
                  >
                    <Icon className="w-4 h-4 text-cream-60 group-hover:text-phase-green transition-colors shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-cream text-sm font-body font-medium">
                        {label}
                      </div>
                      <div className="text-cream-40 text-[11px] font-body truncate">
                        {desc}
                      </div>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-cream-20 group-hover:text-cream-60 group-hover:translate-x-0.5 transition-all shrink-0" />
                  </Link>
                ))}
              </div>
            </section>

            {/* Trust footer — open source + API + methodology */}
            <section
              className="opacity-0 animate-fade-in-up"
              style={{ animationDelay: "0.32s" }}
            >
              <div className="rounded-xl border border-cream-8 bg-cream-5 px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-cream-60" />
                  <span className="text-cream-60 text-xs font-body">
                    Every formula is{" "}
                    <Link
                      href="/methodology"
                      className="text-phase-green hover:underline"
                    >
                      auditable
                    </Link>
                    . Source on{" "}
                    <a
                      href="https://github.com/Devour6/monad-income-tracker"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-phase-green hover:underline"
                    >
                      GitHub
                    </a>
                    .
                  </span>
                </div>
                <Link
                  href="/sdk"
                  className="inline-flex items-center gap-1.5 text-xs font-body text-cream-60 hover:text-cream transition-colors"
                >
                  Free API
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </section>
          </>
        )}
      </div>

      <Footer />
    </div>
  );
}
