"use client";

/**
 * Home page — minimal, search-first.
 *
 * Selecting a validator from the search routes directly to /validators/[id]
 * which is the full dashboard (date range, FX toggle, CSV/PDF export, etc.).
 * No preview tile here — we don't fork the rendering paths.
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

const EXPLORE_LINKS: Array<{ href: string; label: string; desc: string }> = [
  { href: "/stake", label: "All validators", desc: "Sortable leaderboard" },
  { href: "/network", label: "Network overview", desc: "Aggregate stats" },
  { href: "/compare", label: "Compare", desc: "Side-by-side" },
  { href: "/simulate", label: "Simulate", desc: "Project delegator returns" },
  { href: "/mev", label: "MEV", desc: "Priority fee analytics" },
  { href: "/methodology", label: "Methodology", desc: "How numbers are computed" },
];

export default function Home() {
  const router = useRouter();
  const [validators, setValidators] = useState<ValidatorListItem[]>([]);
  const [overview, setOverview] = useState<NetworkOverview | null>(null);
  const [livePrice, setLivePrice] = useState<LivePrice | null>(null);
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

  // Selecting a validator from the search bar takes you straight to its
  // full dashboard. No half-baked preview on the home page.
  function handleSelect(v: ValidatorListItem) {
    router.push(`/validators/${v.validatorId}`);
  }

  const monPrice = livePrice?.monPriceUsd ?? overview?.monPriceUsd ?? 0;

  return (
    <div className="relative z-[1] min-h-screen px-6 pt-10 pb-6">
      <AuroraBg />
      <FloatingParticles />

      <div className="max-w-[1100px] mx-auto">
        {/* Top bar — title + nav links */}
        <header className="flex items-center justify-between mb-12 opacity-0 animate-fade-in-up">
          <Link href="/" className="flex items-center gap-3">
            <h1 className="font-display text-xl text-cream tracking-[0.04em]">
              Monad Income Tracker
            </h1>
            {overview?.activeValidators ? (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-body uppercase tracking-widest text-cream-40 bg-cream-5 border border-cream-8 rounded-full px-2.5 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-phase-green animate-pulse" />
                {overview.activeValidators} validators · epoch {overview.latestEpoch}
              </span>
            ) : null}
          </Link>
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

        {/* Hero */}
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
            {/* Search — pick a validator → routes to its dashboard */}
            <section
              className="max-w-2xl mx-auto mb-4 opacity-0 animate-fade-in-up"
              style={{ animationDelay: "0.16s" }}
            >
              <ValidatorSearch
                validators={validators}
                selected={null}
                onSelect={handleSelect}
              />
              <div className="mt-3 text-center text-[11px] font-body text-cream-40">
                Pick a validator → opens their full dashboard with date range,
                FX toggle, CSV / PDF export.
              </div>
            </section>

            {/* Explore */}
            <section
              className="mt-12 mb-12 opacity-0 animate-fade-in-up"
              style={{ animationDelay: "0.24s" }}
            >
              <div className="text-[10px] font-body uppercase tracking-widest text-cream-40 mb-3 text-center">
                Explore
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {EXPLORE_LINKS.map((l) => (
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
            </section>
          </>
        )}

        <Footer />
      </div>
    </div>
  );
}
