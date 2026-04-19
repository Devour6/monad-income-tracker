"use client";

import { TrendingUp, Coins, CalendarDays, Zap } from "lucide-react";

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

interface ValidatorListItem {
  validatorId: number;
  name: string;
  stakeMon: number;
  commissionPct: number;
}

interface IncomeSummaryProps {
  summary: IncomeSummaryData | null;
  validator: ValidatorListItem;
  loading: boolean;
}

function formatMon(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function formatUsd(n: number): string {
  if (!n || n === 0) return "";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function Skeleton() {
  return (
    <div className="h-8 w-24 bg-cream-5 rounded animate-pulse" />
  );
}

export function IncomeSummary({
  summary,
  validator,
  loading,
}: IncomeSummaryProps) {
  const cards = [
    {
      label: "Avg per Epoch",
      value: summary ? formatMon(summary.avgBlockRewardsPerEpoch) : null,
      unit: "MON",
      icon: Zap,
      sublabel: `${summary?.epochsWithIncome ?? 0} epochs tracked`,
    },
    {
      label: "Est. Daily",
      value: summary ? formatMon(summary.estimatedDailyMon) : null,
      usdValue: summary ? formatUsd(summary.estimatedDailyUsd) : null,
      unit: "MON",
      icon: CalendarDays,
      sublabel: "~4.36 epochs/day",
    },
    {
      label: "Est. Monthly",
      value: summary ? formatMon(summary.estimatedMonthlyMon) : null,
      usdValue: summary ? formatUsd(summary.estimatedMonthlyUsd) : null,
      unit: "MON",
      icon: Coins,
      sublabel: "30-day projection",
    },
    {
      label: "Est. Annual",
      value: summary ? formatMon(summary.estimatedAnnualMon) : null,
      usdValue: summary ? formatUsd(summary.estimatedAnnualUsd) : null,
      unit: "MON",
      icon: TrendingUp,
      sublabel: "365-day projection",
    },
  ];

  return (
    <div className="mt-6">
      {/* Validator name badge */}
      <div className="flex items-center gap-3 mb-4">
        <h2 className="font-display text-lg text-cream tracking-wide">
          {validator.name}
        </h2>
        <span className="text-cream-20 text-xs font-mono bg-cream-5 px-2 py-0.5 rounded">
          {validator.commissionPct}% commission
        </span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
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
            {loading || !card.value ? (
              <Skeleton />
            ) : (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-cream text-2xl font-body font-semibold stat-shimmer">
                    {card.value}
                  </span>
                  <span className="text-cream-40 text-xs font-body">
                    {card.unit}
                  </span>
                </div>
                {"usdValue" in card && card.usdValue ? (
                  <div className="text-cream-20 text-xs font-body mt-1">
                    {card.usdValue}
                  </div>
                ) : (
                  <div className="text-cream-20 text-xs font-body mt-1">
                    {card.sublabel}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
