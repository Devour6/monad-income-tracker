"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Activity,
  GitCompareArrows,
  Coins,
  BookOpen,
  Scale,
  FileText,
  TrendingUp,
  Zap,
  Bell,
  Code2,
} from "lucide-react";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";

/**
 * Hub page — surfaces every tool the tracker offers in one place.
 * Lives at /explore so it can be reached without modifying the home
 * page header.
 */

interface Card {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  blurb: string;
  badge?: string;
}

const ROWS: { heading: string; cards: Card[] }[] = [
  {
    heading: "Discover",
    cards: [
      {
        href: "/stake",
        icon: Coins,
        title: "Choose a validator",
        blurb:
          "Sortable leaderboard — APY, commission, efficiency, self-stake. The decision-tool view.",
      },
      {
        href: "/network",
        icon: Activity,
        title: "Network overview",
        blurb:
          "Aggregate stake, validator count, MON price, epoch progress.",
      },
      {
        href: "/compare",
        icon: GitCompareArrows,
        title: "Compare validators",
        blurb: "Side-by-side rewards, commission, efficiency overlays.",
      },
    ],
  },
  {
    heading: "Operate & analyze",
    cards: [
      {
        href: "/reports",
        icon: FileText,
        title: "Income reports (CSV / PDF)",
        blurb:
          "Date range, server cost input, per-epoch vs end-of-period FX. Tax-ready exports.",
        badge: "10x svt.one",
      },
      {
        href: "/simulate",
        icon: TrendingUp,
        title: "Delegator simulator",
        blurb:
          "Project income from any validator + stake size. Variance bands from observed APY.",
        badge: "New",
      },
      {
        href: "/mev",
        icon: Zap,
        title: "MEV / priority fees",
        blurb:
          "Network time series, validator leaderboard by share, unmapped-miner watchlist.",
        badge: "Monad-native",
      },
      {
        href: "/alerts",
        icon: Bell,
        title: "Alerts & webhooks",
        blurb:
          "Discord/Slack pings on commission changes, missed blocks, APY drops, self-stake moves.",
        badge: "New",
      },
    ],
  },
  {
    heading: "Build",
    cards: [
      {
        href: "/widgets",
        icon: Code2,
        title: "Embeddable widgets",
        blurb:
          "Drop validator stats into your site. Server-rendered iframe, no JS, theme-matched.",
        badge: "New",
      },
      {
        href: "/docs",
        icon: BookOpen,
        title: "API docs",
        blurb:
          "Public REST API, rate limits, API keys. Same data that powers this site.",
      },
      {
        href: "/methodology",
        icon: Scale,
        title: "Methodology",
        blurb:
          "Every formula, every data source, every assumption — auditable.",
      },
    ],
  },
];

export default function ExplorePage() {
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

        <header className="mb-12">
          <h1 className="font-display text-3xl text-cream tracking-wide">
            Everything in the tracker
          </h1>
          <p className="mt-3 max-w-2xl text-sm font-body text-cream-60 leading-relaxed">
            Validator analytics built native to Monad — real per-block priority
            fees, production efficiency, four APY lenses, alerts, embeds, and
            tax-ready reports. Pick a tool.
          </p>
        </header>

        {ROWS.map((row) => (
          <section key={row.heading} className="mb-12">
            <h2 className="mb-4 font-body text-xs uppercase tracking-widest text-cream-40">
              {row.heading}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {row.cards.map((c) => {
                const Icon = c.icon;
                return (
                  <Link
                    key={c.href}
                    href={c.href}
                    className="group relative flex flex-col gap-2 rounded-xl border border-cream-8 bg-cream-5 p-4 transition-all hover:border-cream-20 hover:bg-cream-8"
                  >
                    {c.badge && (
                      <span className="absolute right-3 top-3 rounded-full border border-phase-green/30 bg-phase-green/10 px-2 py-0.5 font-body text-[9px] uppercase tracking-widest text-phase-green">
                        {c.badge}
                      </span>
                    )}
                    <Icon className="h-4 w-4 text-phase-green" />
                    <div className="font-display text-base text-cream tracking-wide">
                      {c.title}
                    </div>
                    <p className="font-body text-xs text-cream-60 leading-relaxed">
                      {c.blurb}
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <Footer />
    </div>
  );
}
