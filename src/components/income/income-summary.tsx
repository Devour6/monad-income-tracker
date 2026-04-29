"use client";

import { Wallet, Users, TrendingUp, Clock, Zap } from "lucide-react";

interface IncomeSummary {
  observed: {
    epochCount: number;
    snapshotCount: number;
    daysObserved: number;
    poolRewardsMon: number;
    poolRewardsUsd: number;
    commissionMon: number;
    commissionUsd: number;
    delegatorRewardsMon: number;
    selfStakeRewardsMon?: number | null;
    priorityFeesMon?: number | null;
    priorityFeesUsd?: number | null;
    validatorTotalMon?: number | null;
    validatorTotalUsd?: number | null;
    currentSelfStakeMon?: number | null;
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
    priorityFeesPerDayMon?: number | null;
    priorityFeesPerMonthMon?: number | null;
    priorityFeesPerYearMon?: number | null;
    priorityFeesPerYearUsd?: number | null;
    validatorPerDayMon?: number | null;
    validatorPerMonthMon?: number | null;
    validatorPerYearMon?: number | null;
    validatorPerYearUsd?: number | null;
  };
  hasPriorityFeeData?: boolean;
  hasSelfStakeData?: boolean;
  latestMonPriceUsd: number;
}

interface ValidatorListItem {
  validatorId: number;
  name: string;
  stakeMon: number;
  commissionPct: number;
}

interface IncomeSummaryProps {
  summary: IncomeSummary | null;
  validator: ValidatorListItem;
  loading: boolean;
}

function formatMon(n: number): string {
  if (!isFinite(n)) return "—";
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

function Skeleton() {
  return <div className="h-8 w-24 bg-cream-5 rounded animate-pulse" />;
}

export function IncomeSummary({
  summary,
  validator,
  loading,
}: IncomeSummaryProps) {
  const observed = summary?.observed;
  const rates = summary?.rates;

  // PRIMARY cards: REALIZED earnings in the observed window. The headline
  // is the validator's TOTAL income (commission + self-stake share +
  // priority fees), with the breakdown shown in the row below.
  const totalCard =
    observed && observed.validatorTotalMon != null
      ? {
          label: "Validator Total Income",
          value: formatMon(observed.validatorTotalMon),
          usdValue:
            observed.validatorTotalUsd != null
              ? formatUsd(observed.validatorTotalUsd)
              : null,
          unit: "MON",
          icon: Wallet,
          sublabel: `commission + self-stake + priority fees · ${formatDays(observed.daysObserved)}`,
          highlight: true,
        }
      : {
          label: "Validator Commission",
          value: observed ? formatMon(observed.commissionMon) : null,
          usdValue: observed ? formatUsd(observed.commissionUsd) : null,
          unit: "MON",
          icon: Wallet,
          sublabel: observed
            ? `Realized over ${formatDays(observed.daysObserved)}`
            : "",
          highlight: true,
        };

  const realizedCards = [
    totalCard,
    {
      label: "Commission",
      value: observed ? formatMon(observed.commissionMon) : null,
      usdValue: observed ? formatUsd(observed.commissionUsd) : null,
      unit: "MON",
      icon: Users,
      sublabel: `${validator.commissionPct}% of pool rewards`,
      highlight: false,
    },
    {
      label: "Priority Fees (MEV)",
      value:
        observed && observed.priorityFeesMon != null
          ? formatMon(observed.priorityFeesMon)
          : null,
      usdValue:
        observed && observed.priorityFeesUsd != null
          ? formatUsd(observed.priorityFeesUsd)
          : null,
      unit: "MON",
      icon: Zap,
      sublabel: summary?.hasPriorityFeeData
        ? "Indexed from block-level data"
        : "Indexer warming up — coming soon",
      highlight: false,
    },
    {
      label: "Observation Window",
      value: observed ? `${observed.epochCount}` : null,
      usdValue: null,
      unit: "epochs",
      icon: Clock,
      sublabel: observed
        ? `${formatDays(observed.daysObserved)} • ${observed.snapshotCount} snapshots`
        : "",
      highlight: false,
    },
  ];

  return (
    <div className="mt-6">
      {/* Validator name + realized headline */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h2 className="font-display text-lg text-cream tracking-wide">
          {validator.name}
        </h2>
        <span className="text-cream-20 text-xs font-mono bg-cream-5 px-2 py-0.5 rounded">
          {validator.commissionPct}% commission
        </span>
        {observed && observed.firstEpoch !== null && observed.lastEpoch !== null && (
          <span className="text-cream-20 text-xs font-mono bg-cream-5 px-2 py-0.5 rounded">
            epochs {observed.firstEpoch}–{observed.lastEpoch}
          </span>
        )}
      </div>

      {/* Realized earnings section */}
      <div className="mb-2">
        <h3 className="text-cream-40 text-[11px] font-body uppercase tracking-[0.12em] mb-3">
          Realized Earnings
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {realizedCards.map((card) => (
            <div
              key={card.label}
              className={`${card.highlight ? "bg-phase-green/5 border-phase-green/20" : "bg-cream-5 border-cream-8"} border rounded-xl p-4 card-hover`}
            >
              <div className="flex items-center gap-2 mb-3">
                <card.icon
                  className={`w-4 h-4 ${card.highlight ? "text-phase-green" : "text-cream-40"}`}
                />
                <span
                  className={`text-xs font-body uppercase tracking-wider ${card.highlight ? "text-phase-green" : "text-cream-40"}`}
                >
                  {card.label}
                </span>
              </div>
              {loading || !card.value ? (
                <Skeleton />
              ) : (
                <>
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={`text-2xl font-body font-semibold stat-shimmer ${card.highlight ? "text-phase-green" : "text-cream"}`}
                    >
                      {card.value}
                    </span>
                    <span className="text-cream-40 text-xs font-body">
                      {card.unit}
                    </span>
                  </div>
                  {card.usdValue ? (
                    <div className={`text-xs font-body mt-1 ${card.highlight ? "text-phase-green/70" : "text-cream-20"}`}>
                      {card.usdValue}
                    </div>
                  ) : card.sublabel ? (
                    <div className="text-cream-20 text-xs font-body mt-1">
                      {card.sublabel}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Run rate section — clearly labeled as projection, NOT realized */}
      {rates && observed && observed.epochCount > 0 && (
        <div className="mt-6">
          <h3 className="text-cream-40 text-[11px] font-body uppercase tracking-[0.12em] mb-3 flex items-center gap-2">
            <TrendingUp className="w-3 h-3" />
            Commission Run Rate
            <span className="text-cream-20 text-[10px] normal-case tracking-normal font-light">
              (extrapolated from observed average — not realized)
            </span>
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-cream-5 border border-cream-8 rounded-xl p-4">
              <div className="text-cream-40 text-xs font-body uppercase tracking-wider mb-2">
                Per Day
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-cream text-xl font-body font-semibold">
                  {formatMon(rates.commissionPerDayMon)}
                </span>
                <span className="text-cream-40 text-xs">MON</span>
              </div>
              <div className="text-cream-20 text-xs font-body mt-1">
                {formatUsd(rates.commissionPerDayUsd)}
              </div>
            </div>
            <div className="bg-cream-5 border border-cream-8 rounded-xl p-4">
              <div className="text-cream-40 text-xs font-body uppercase tracking-wider mb-2">
                Per Month
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-cream text-xl font-body font-semibold">
                  {formatMon(rates.commissionPerMonthMon)}
                </span>
                <span className="text-cream-40 text-xs">MON</span>
              </div>
              <div className="text-cream-20 text-xs font-body mt-1">
                {formatUsd(rates.commissionPerMonthUsd)}
              </div>
            </div>
            <div className="bg-cream-5 border border-cream-8 rounded-xl p-4">
              <div className="text-cream-40 text-xs font-body uppercase tracking-wider mb-2">
                Per Year
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-cream text-xl font-body font-semibold">
                  {formatMon(rates.commissionPerYearMon)}
                </span>
                <span className="text-cream-40 text-xs">MON</span>
              </div>
              <div className="text-cream-20 text-xs font-body mt-1">
                {formatUsd(rates.commissionPerYearUsd)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
