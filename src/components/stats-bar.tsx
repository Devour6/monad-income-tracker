"use client";

import { useMemo } from "react";
import { VALIDATORS } from "@/data/validators";
import { BLOCKS_PER_DAY, BLOCK_REWARD, MAX_VALIDATORS } from "@/lib/constants";
import { fmtCompact, fmtPercent } from "@/lib/formatters";
import type { CalculatorInputs } from "@/lib/types";
import type { LiveData } from "@/hooks/use-live-data";

interface StatsBarProps {
  inputs: CalculatorInputs;
  liveData?: LiveData | null;
  loading?: boolean;
}

export function StatsBar({ inputs, liveData, loading }: StatsBarProps) {
  const stats = useMemo(() => {
    const count = liveData?.activeValidators ?? VALIDATORS.length;
    let totalStaked = 0;
    let totalComm = 0;
    let totalApy = 0;

    for (const v of VALIDATORS) {
      totalStaked += v.totalStake;
      totalComm += v.commission;
      const ns = inputs.networkStake > 0 ? v.totalStake / inputs.networkStake : 0;
      const bpd = BLOCKS_PER_DAY * ns;
      const dbr = bpd * BLOCK_REWARD;
      const apy = v.totalStake > 0 ? ((dbr * 365) / v.totalStake) * 100 : 0;
      totalApy += apy;
    }

    return {
      count,
      totalStaked: fmtCompact(liveData?.networkStake ?? totalStaked),
      avgCommission: fmtPercent(totalComm / VALIDATORS.length, 1),
      avgApy: fmtPercent(totalApy / VALIDATORS.length),
    };
  }, [inputs.networkStake, liveData]);

  const isLive = !!liveData?.updatedAt;

  const items = [
    { label: "Active Validators", value: `${stats.count}/${MAX_VALIDATORS}` },
    { label: "Total Staked", value: `${stats.totalStaked} MON` },
    { label: "Avg Commission", value: stats.avgCommission },
    { label: "Avg Gross APY", value: stats.avgApy },
  ];

  return (
    <div className="mt-8 opacity-0 animate-fade-in-up" style={{ animationDelay: "0.5s" }}>
      <div className="flex items-center gap-6 flex-wrap justify-center py-3 px-4 rounded-xl bg-cream-5/50 border border-cream-8/50">
        {/* Live indicator */}
        {loading ? (
          <span className="text-[11px] text-cream-20 font-body">Loading...</span>
        ) : isLive ? (
          <span className="flex items-center gap-1.5 text-[11px] text-phase-green font-body">
            <span className="w-1.5 h-1.5 rounded-full bg-phase-green animate-pulse" />
            Live
          </span>
        ) : (
          <span className="text-[11px] text-cream-20 font-body">Static</span>
        )}

        <span className="w-px h-4 bg-cream-8 hidden md:block" />

        {items.map((item, i) => (
          <span key={item.label} className="flex items-center gap-2">
            <span className="text-[11px] text-cream-20 font-light">{item.label}</span>
            <span className="text-[13px] text-cream-60 font-semibold">{item.value}</span>
            {i < items.length - 1 && (
              <span className="w-px h-3 bg-cream-8 ml-4 hidden md:block" />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
