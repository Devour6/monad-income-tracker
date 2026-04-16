"use client";

import type { CalculatorResults } from "@/lib/types";
import { fmt, fmtPercent } from "@/lib/formatters";

interface RevenueBreakdownProps {
  results: CalculatorResults;
  monPrice: number;
}

export function RevenueBreakdown({ results, monPrice }: RevenueBreakdownProps) {
  const rows = [
    {
      label: "Blocks proposed / day",
      value: fmt(results.blocksPerDay, 1),
    },
    {
      label: "Block rewards / day",
      value: fmt(results.dailyBlockRewards, 0) + " MON",
    },
    {
      label: "Commission income / day",
      value: fmt(results.dailyCommission, 0) + " MON",
    },
    {
      label: "Self-stake rewards / day",
      value: fmt(results.dailySelfRewards, 0) + " MON",
    },
    {
      label: "Priority fees / day",
      value: fmt(results.dailyPriorityFees, 0) + " MON",
    },
    {
      label: "Total daily revenue",
      value:
        fmt(results.dailyTotalMon, 0) +
        " MON ($" +
        fmt(results.dailyTotalMon * monPrice, 2) +
        ")",
    },
    {
      label: "Network share",
      value: fmtPercent(results.networkShare * 100, 4),
    },
  ];

  return (
    <div
      className="bg-cream-5 border border-cream-8 rounded-2xl p-6 card-hover"
    >

      <h2 className="font-display text-[11px] font-normal uppercase tracking-[0.12em] text-cream-40 mb-5">
        Revenue Breakdown
      </h2>

      <table className="w-full border-collapse mt-2">
        <caption className="sr-only">Revenue breakdown calculations</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-cream-5 last:border-0">
              <th scope="row" className="py-[9px] text-[13px] font-normal text-cream-40 text-left">
                {row.label}
              </th>
              <td className="py-[9px] text-[13px] font-semibold text-cream-60 text-right">
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
