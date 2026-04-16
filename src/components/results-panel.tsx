"use client";

import type { CalculatorResults } from "@/lib/types";
import { fmt, fmtUsd, fmtPercent } from "@/lib/formatters";

interface ResultsPanelProps {
  results: CalculatorResults;
}

export function ResultsPanel({ results }: ResultsPanelProps) {
  const profitClass =
    results.netProfitUsd >= 0 ? "text-phase-green" : "text-phase-red";
  const monthlyClass =
    results.monthlyProfitUsd >= 0 ? "text-phase-green" : "text-phase-red";

  return (
    <div
      className="bg-cream-5 border border-cream-8 rounded-2xl p-6 opacity-0 animate-fade-in-up"
      style={{ animationDelay: "0.32s" }}
    >

      <h2 className="font-display text-[11px] font-normal uppercase tracking-[0.12em] text-cream-40 mb-5">
        Profitability Estimate
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Annual Revenue */}
        <div className="bg-cream-5 border border-cream-8 rounded-[10px] p-4 card-hover">
          <div className="font-display text-[9px] uppercase tracking-[0.1em] text-cream-40 mb-[6px] font-normal">
            Annual Revenue
          </div>
          <div className="font-body text-[26px] font-bold leading-[1.1] text-cream">
            {fmtUsd(results.annualRevenueUsd)}
          </div>
          <div className="text-xs text-cream-20 mt-1 font-light">
            {fmt(results.annualTotalMon, 0)} MON
          </div>
        </div>

        {/* Annual Costs */}
        <div className="bg-cream-5 border border-cream-8 rounded-[10px] p-4 card-hover">
          <div className="font-display text-[9px] uppercase tracking-[0.1em] text-cream-40 mb-[6px] font-normal">
            Annual Costs
          </div>
          <div className="font-body text-[26px] font-bold leading-[1.1] text-phase-red">
            {fmtUsd(results.annualCostsUsd)}
          </div>
          <div className="text-xs text-cream-20 mt-1 font-light">
            ${fmt(results.annualCostsUsd / 12)}/mo server + other
          </div>
        </div>

        {/* Net Annual Profit - full width */}
        <div className="col-span-2 bg-cream-5 border border-cream-8 rounded-[10px] p-4 card-hover" aria-live="polite" aria-atomic="true">
          <div className="font-display text-[9px] uppercase tracking-[0.1em] text-cream-40 mb-[6px] font-normal">
            Net Annual Profit
          </div>
          <div
            className={`font-body text-[26px] font-bold leading-[1.1] ${profitClass}`}
          >
            {fmtUsd(results.netProfitUsd)}
          </div>
          <div className="text-xs text-cream-20 mt-1 font-light">
            {fmt(results.annualTotalMon, 0)} MON earned / yr
          </div>
        </div>

        {/* Monthly Profit */}
        <div className="bg-cream-5 border border-cream-8 rounded-[10px] p-4 card-hover">
          <div className="font-display text-[9px] uppercase tracking-[0.1em] text-cream-40 mb-[6px] font-normal">
            Monthly Profit
          </div>
          <div
            className={`font-body text-[26px] font-bold leading-[1.1] ${monthlyClass}`}
          >
            {fmtUsd(results.monthlyProfitUsd)}
          </div>
        </div>

        {/* Gross APY */}
        <div className="bg-cream-5 border border-cream-8 rounded-[10px] p-4 card-hover">
          <div className="font-display text-[9px] uppercase tracking-[0.1em] text-cream-40 mb-[6px] font-normal">
            Gross APY
          </div>
          <div className="font-body text-[26px] font-bold leading-[1.1] text-cream">
            {fmtPercent(results.grossApy)}
          </div>
          <div className="text-xs text-cream-20 mt-1 font-light">
            before costs
          </div>
        </div>
      </div>
    </div>
  );
}
