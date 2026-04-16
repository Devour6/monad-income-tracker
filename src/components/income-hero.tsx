"use client";

import type { CalculatorResults, Verdict } from "@/lib/types";
import { useAnimatedNumber } from "@/hooks/use-animated-number";
import { fmtCompact } from "@/lib/formatters";

type Period = "yearly" | "monthly" | "daily" | "epoch";

interface IncomeHeroProps {
  results: CalculatorResults;
  verdict: Verdict;
  monPrice: number;
  period: Period;
  setPeriod: (p: Period) => void;
}

const PERIOD_LABELS: { key: Period; label: string }[] = [
  { key: "yearly", label: "YEARLY" },
  { key: "monthly", label: "MONTHLY" },
  { key: "daily", label: "DAILY" },
  { key: "epoch", label: "EPOCH" },
];

// Monad epoch ≈ 5.5 hours → ~4.36 epochs/day → ~1593/year
const EPOCHS_PER_YEAR = 1593;

function daysForPeriod(period: Period): number {
  switch (period) {
    case "yearly": return 365;
    case "monthly": return 30.42;
    case "daily": return 1;
    case "epoch": return 365 / EPOCHS_PER_YEAR;
  }
}

export function IncomeHero({
  results,
  verdict,
  monPrice,
  period,
  setPeriod,
}: IncomeHeroProps) {
  const days = daysForPeriod(period);

  // Revenue from block rewards + commission + self-stake (everything except priority fees)
  const blockRevenueMon = (results.dailyCommission + results.dailySelfRewards) * days;
  const blockRevenueUsd = blockRevenueMon * monPrice;

  // Priority fees
  const priorityFeesMon = results.dailyPriorityFees * days;
  const priorityFeesUsd = priorityFeesMon * monPrice;

  // Costs
  const serverCostsUsd = results.annualCostsUsd * (days / 365);
  const serverCostsMon = monPrice > 0 ? serverCostsUsd / monPrice : 0;

  // Net income
  const netIncomeUsd = blockRevenueUsd + priorityFeesUsd - serverCostsUsd;
  const netIncomeMon = blockRevenueMon + priorityFeesMon - serverCostsMon;

  // Verdict bar color
  let barColor: string;
  if (verdict === "profitable") {
    barColor = "from-transparent via-phase-green to-transparent";
  } else if (verdict === "breakeven" || verdict === "marginal") {
    barColor = "from-transparent via-phase-yellow to-transparent";
  } else {
    barColor = "from-transparent via-phase-red to-transparent";
  }

  const profitClass = netIncomeUsd >= 0 ? "text-phase-green" : "text-phase-red";

  return (
    <div
      className="bg-cream-5 border border-cream-8 rounded-2xl p-6 mb-6 opacity-0 animate-fade-in-up relative overflow-hidden"
      style={{ animationDelay: "0.24s" }}
    >
      {/* Top gradient bar */}
      <div className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${barColor}`} />

      {/* Period tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {PERIOD_LABELS.map(({ key, label }) => (
          <button
            key={key}
            className={`px-4 py-[7px] rounded-lg text-xs font-body font-semibold cursor-pointer transition-all border btn-press ${
              period === key
                ? "border-phase-green bg-phase-green/15 text-phase-green"
                : "bg-cream-5 border-cream-8 text-cream-40 hover:border-cream-20 hover:text-cream"
            }`}
            onClick={() => setPeriod(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* NET INCOME — the hero number */}
      <div className="text-center mb-6" aria-live="polite" aria-atomic="true">
        <div className="font-display text-[11px] uppercase tracking-[0.12em] text-cream-40 mb-2 font-normal">
          Net Income
        </div>
        <AnimatedUsd value={netIncomeUsd} className={`font-body text-[56px] md:text-[72px] font-bold leading-[1] tracking-tight ${profitClass}`} />
        <div className="text-sm text-cream-40 mt-2 font-light">
          {fmtCompact(Math.abs(netIncomeMon))} MON
        </div>
      </div>

      {/* Revenue breakdown cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <BreakdownCard
          label="BLOCK REVENUE"
          usd={blockRevenueUsd}
          mon={blockRevenueMon}
          colorClass="text-phase-green"
        />
        <BreakdownCard
          label="PRIORITY FEES"
          usd={priorityFeesUsd}
          mon={priorityFeesMon}
          colorClass="text-phase-green"
        />
        <BreakdownCard
          label="SERVER COSTS"
          usd={-serverCostsUsd}
          mon={-serverCostsMon}
          colorClass="text-phase-red"
        />
      </div>
    </div>
  );
}

function AnimatedUsd({ value, className }: { value: number; className: string }) {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "$" : "-$";
  const animated = useAnimatedNumber(abs, 500, abs >= 1000 ? 0 : 2);

  return (
    <div className={className}>
      {sign}{abs >= 1e6 ? (abs / 1e6).toFixed(2) + "M" : animated}
    </div>
  );
}

function BreakdownCard({
  label,
  usd,
  mon,
  colorClass,
}: {
  label: string;
  usd: number;
  mon: number;
  colorClass: string;
}) {
  const abs = Math.abs(usd);
  const sign = usd < 0 ? "-$" : "$";
  const animated = useAnimatedNumber(abs, 500, abs >= 1000 ? 0 : 2);

  return (
    <div className="bg-cream-5 border border-cream-8 rounded-xl p-4 card-hover">
      <div className="font-display text-[9px] uppercase tracking-[0.1em] text-cream-40 mb-[6px] font-normal">
        {label}
      </div>
      <div className={`font-body text-[24px] font-bold leading-[1.1] ${colorClass}`}>
        {sign}{abs >= 1e6 ? (abs / 1e6).toFixed(2) + "M" : animated}
      </div>
      <div className="text-[11px] text-cream-20 mt-1 font-light">
        {fmtCompact(Math.abs(mon))} MON
      </div>
    </div>
  );
}
