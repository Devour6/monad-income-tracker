"use client";

import type { Verdict, CalculatorResults } from "@/lib/types";
import { fmtUsd } from "@/lib/formatters";

interface VerdictCardProps {
  verdict: Verdict;
  results: CalculatorResults;
}

export function VerdictCard({ verdict, results }: VerdictCardProps) {
  const { netProfitUsd, annualCostsUsd, monthlyProfitUsd } = results;

  let bgClass: string;
  let borderClass: string;
  let barColor: string;
  let title: string;
  let detail: string;

  if (verdict === "profitable") {
    bgClass = "bg-green-dim";
    borderClass = "border-phase-green/20";
    barColor = "from-transparent via-phase-green to-transparent";
    title = "Profitable";
    detail = `Net ${fmtUsd(netProfitUsd)}/yr after ${fmtUsd(
      annualCostsUsd
    )} in operating costs. ~${fmtUsd(monthlyProfitUsd)}/mo net.`;
  } else if (verdict === "breakeven") {
    bgClass = "bg-yellow-dim";
    borderClass = "border-phase-yellow/20";
    barColor = "from-transparent via-phase-yellow to-transparent";
    title = "Break Even";
    detail = `Revenue covers ${fmtUsd(annualCostsUsd)} in annual operating costs with minimal margin. Increasing delegated stake or reducing costs would improve profitability.`;
  } else if (verdict === "marginal") {
    bgClass = "bg-yellow-dim";
    borderClass = "border-phase-yellow/20";
    barColor = "from-transparent via-phase-yellow to-transparent";
    title = "Marginally Profitable";
    detail = `Only ${fmtUsd(
      netProfitUsd
    )}/yr profit. Consider if the operational overhead is worth it.`;
  } else {
    bgClass = "bg-red-dim";
    borderClass = "border-phase-red/20";
    barColor = "from-transparent via-phase-red to-transparent";
    title = "Not Profitable";
    detail = `Operating at a loss of ${fmtUsd(
      Math.abs(netProfitUsd)
    )}/yr. Costs exceed rewards at current MON price.`;
  }

  return (
    <div
      aria-live="polite"
      className={`mt-4 p-[22px] rounded-[14px] text-center transition-all relative overflow-hidden border animate-glow-pulse ${bgClass} ${borderClass}`}
    >
      <div
        className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${barColor}`}
      />
      <div className="font-display text-[17px] font-normal mb-[6px]">
        {title}
      </div>
      <div className="text-[13px] text-cream-60 font-light">{detail}</div>
    </div>
  );
}
