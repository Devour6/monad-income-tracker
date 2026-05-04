"use client";

/**
 * Home page — minimal, search-first, mobile-friendly.
 *
 * Layout choices:
 * - Top bar: title + tiny live status dot ("12m ago" tooltip-style) — indexer
 *   freshness lives here, not as a giant pill next to the stats. Solves the
 *   "awkward floating sentence" problem.
 * - Hero: 3-stat tile (price / staked / APY), centered, no other ornamentation.
 * - Search: single combobox (the input IS the field, no two-step modal).
 * - Explore: 3-column tile grid grouped by purpose. API + API Docs get their
 *   own row at the top because they're the differentiator vs svt.one.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";
import { ValidatorSearch } from "@/components/income/validator-search";

interface ValidatorListItem {
  validatorId: number;
  name: string;
  authAddress: string;
  stakeMon: number;
  commissionPct: number;
  lastEpoch: number;
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

interface IndexerStatus {
  cursor: { lastBlock: string; lastEpoch: number; updatedAt: string };
  chainHead: string;
  lagBlocks: number;
}

function fmtUsd(n: number): string {
  if (!isFinite(n) || n <= 0) return "$0";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPrice(n: number): string {
  if (!isFinite(n) || n <= 0) return "—";
  return `$${n.toFixed(4)}`;
}

function fmtRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

// Explore tiles, grouped. The first group is the differentiator (API access).
// The second is data exploration. Order matters — what we show first signals
// what we want users to use.
const EXPLORE_GROUPS: Array<{
  label: string;
  links: Array<{ href: string; label: string; desc: string }>;
}> = [
  {
    label: "Build with the data",
    links: [
      { href: "/sdk", label: "Public API", desc: "REST endpoints, no auth" },
      { href: "/api-explorer", label: "API reference", desc: "Interactive Swagger" },
      { href: "/docs", label: "Integration guide", desc: "Curl / JS / Python" },
    ],
  },
  {
    label: "Explore additional tools",
    links: [
      { href: "/stake", label: "All validators", desc: "Sortable leaderboard" },
      { href: "/network", label: "Network overview", desc: "Aggregate stats" },
      { href: "/compare", label: "Compare validators", desc: "Up to 5 side-by-side" },
      { href: "/simulate", label: "Delegator simulator", desc: "Project your returns" },
      { href: "/mev", label: "MEV analytics", desc: "Priority fee leaderboard" },
      { href: "/methodology", label: "Methodology", desc: "Every formula, audited" },
    ],
  },
];

export default function Home() {
  const router = useRouter();
  const [validators, setValidators] = useState<ValidatorListItem[]>([]);
  const [overview, setOverview] = useState<NetworkOverview | null>(null);
  const [livePrice, setLivePrice] = useState<LivePrice | null>(null);
  const [indexer, setIndexer] = useState<IndexerStatus | null>(null);
  const [dbReady, setDbReady] = useState(true);

  useEffect(() => {
    fetch("/api/validators")
      .then((r) => r.json())
      .then((d) => {
        if (d.validators) setValidators(d.validators);
      })
      .catch(() => setDbReady(false));
  }, []);

  useEffect(() => {
    fetch("/api/network/overview")
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setOverview(d);
      })
      .catch(() => {});
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch("/api/v1/indexer/status")
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled && !d.error) setIndexer(d);
        })
        .catch(() => {});
    }
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  function handleSelect(v: ValidatorListItem) {
    router.push(`/validators/${v.validatorId}`);
  }

  const monPrice = livePrice?.monPriceUsd ?? overview?.monPriceUsd ?? 0;
  const indexerHealthy = indexer ? indexer.lagBlocks < 30_000 : true;
  const lastUpdated = indexer ? fmtRelativeTime(indexer.cursor.updatedAt) : null;

  return (
    <div className="relative z-[1] min-h-screen px-4 sm:px-6 pt-8 sm:pt-10 pb-6">
      <AuroraBg />
      <FloatingParticles />

      <div className="max-w-[1100px] mx-auto">
        {/* Top bar: title (with tiny live dot) on left, nav on right */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-12 opacity-0 animate-fade-in-up">
          <Link href="/" className="flex items-center gap-3">
            <h1 className="font-display text-lg sm:text-xl text-cream tracking-[0.04em]">
              Monad Income Tracker
            </h1>
            {/* Tiny live indicator — replaces the giant "Indexer at block X..." pill */}
            {indexer && lastUpdated ? (
              <span
                title={`Block ${Number(indexer.cursor.lastBlock).toLocaleString()} · epoch ${indexer.cursor.lastEpoch} · synced ${lastUpdated}`}
                className="inline-flex items-center gap-1.5 text-[10px] font-mono text-cream-40"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    indexerHealthy
                      ? "bg-phase-green animate-pulse"
                      : "bg-phase-yellow"
                  }`}
                />
                live
              </span>
            ) : null}
          </Link>
          <nav className="flex items-center gap-1 -mx-1 sm:mx-0">
            {[
              { href: "/sdk", label: "API" },
              { href: "/api-explorer", label: "API Docs" },
              { href: "/methodology", label: "Methodology" },
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

        {/* Hero */}
        <section
          className="text-center mb-10 opacity-0 animate-fade-in-up"
          style={{ animationDelay: "0.08s" }}
        >
          <h2 className="font-display text-[34px] sm:text-[52px] leading-[1.05] text-cream tracking-[0.02em] mb-4">
            Validator income
            <br />
            <span className="text-phase-green">measured, not estimated</span>
          </h2>
          <p className="font-body text-cream-60 text-[14px] sm:text-[15px] max-w-xl mx-auto leading-relaxed px-2">
            Lifetime commission, claims, and unclaimed rewards — pulled directly
            from the Monad staking precompile. Open data for every validator.
          </p>

          <div className="mt-8 inline-flex flex-wrap items-center justify-center gap-x-6 sm:gap-x-10 gap-y-3 px-5 sm:px-6 py-3 rounded-xl border border-cream-8 bg-cream-5">
            <div className="text-left">
              <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-phase-green animate-pulse" />
                MON
              </div>
              <div className="font-mono text-cream text-base mt-0.5">
                {fmtPrice(monPrice)}
              </div>
            </div>
            <div className="hidden sm:block w-px h-8 bg-cream-8" />
            <div className="text-left">
              <div className="text-[10px] font-body uppercase tracking-widest text-cream-40">
                Total staked
              </div>
              <div className="font-mono text-cream text-base mt-0.5">
                {overview ? fmtUsd(overview.totalStakeUsd) : "—"}
              </div>
            </div>
            <div className="hidden sm:block w-px h-8 bg-cream-8" />
            <div className="text-left">
              <div className="text-[10px] font-body uppercase tracking-widest text-cream-40">
                Validators
              </div>
              <div className="font-mono text-cream text-base mt-0.5">
                {overview?.activeValidators ?? "—"}
              </div>
            </div>
            <div className="hidden sm:block w-px h-8 bg-cream-8" />
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
            <section
              className="max-w-2xl mx-auto mb-4 opacity-0 animate-fade-in-up"
              style={{ animationDelay: "0.16s" }}
            >
              <ValidatorSearch
                validators={validators}
                selected={null}
                onSelect={handleSelect}
              />
              <div className="mt-3 text-center text-[11px] font-body text-cream-40 px-2">
                Pick a validator → opens their dashboard with date range, FX
                toggle, CSV / PDF export.
              </div>
            </section>

            {/* Explore — grouped by purpose, API tiles first */}
            <section
              className="mt-14 mb-12 opacity-0 animate-fade-in-up space-y-8"
              style={{ animationDelay: "0.24s" }}
            >
              {EXPLORE_GROUPS.map((group) => (
                <div key={group.label}>
                  <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 mb-3">
                    {group.label}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {group.links.map((l) => (
                      <Link
                        key={l.href}
                        href={l.href}
                        className="group rounded-lg border border-cream-8 bg-cream-5 px-4 py-3 hover:border-cream-20 hover:bg-cream-8 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-cream text-sm font-body font-medium">
                              {l.label}
                            </div>
                            <div className="text-cream-40 text-[11px] font-body truncate">
                              {l.desc}
                            </div>
                          </div>
                          <ArrowRight className="w-3.5 h-3.5 text-cream-20 group-hover:text-cream-60 group-hover:translate-x-0.5 transition-all shrink-0" />
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </>
        )}

        <Footer />
      </div>
    </div>
  );
}
