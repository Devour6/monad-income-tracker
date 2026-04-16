"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface EpochIncome {
  epoch: number;
  blockRewardsMon: number;
  commissionMon: number;
  totalMon: number;
  totalUsd: number;
  stakeMon: number;
  monPriceUsd: number;
  timestamp: string;
}

interface IncomeChartProps {
  data: EpochIncome[];
  loading: boolean;
}

function formatMon(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(1);
  return n.toFixed(3);
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: EpochIncome }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;

  return (
    <div className="bg-dark border border-cream-12 rounded-lg px-3 py-2 shadow-xl">
      <div className="text-cream text-xs font-body font-medium mb-1">
        Epoch {d.epoch}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-phase-green">{formatMon(d.totalMon)} MON</span>
        {d.totalUsd > 0 && (
          <span className="text-cream-20">(${d.totalUsd.toFixed(2)})</span>
        )}
      </div>
      {d.commissionMon > 0 && (
        <div className="text-cream-20 text-xs mt-0.5">
          Commission: {formatMon(d.commissionMon)} MON
        </div>
      )}
      <div className="text-cream-20 text-xs mt-0.5">
        {new Date(d.timestamp).toLocaleDateString()}
      </div>
    </div>
  );
}

export function IncomeChart({ data, loading }: IncomeChartProps) {
  if (loading) {
    return (
      <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
        <div className="h-64 flex items-center justify-center">
          <div className="text-cream-20 text-sm font-body animate-pulse">
            Loading chart data...
          </div>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
        <div className="h-64 flex items-center justify-center">
          <div className="text-cream-20 text-sm font-body">
            No income data yet. Run the snapshot cron to start collecting epoch
            data.
          </div>
        </div>
      </div>
    );
  }

  // Reverse for chronological display (data comes newest-first)
  const chartData = [...data].reverse();

  return (
    <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-cream text-sm font-body font-medium uppercase tracking-wider">
          Block Rewards per Epoch
        </h3>
        <div className="flex items-center gap-4 text-xs font-body">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-phase-green" />
            <span className="text-cream-40">Block Rewards</span>
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="rewardGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4ade80" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(243,238,217,0.04)"
          />
          <XAxis
            dataKey="epoch"
            tick={{ fill: "rgba(243,238,217,0.3)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fill: "rgba(243,238,217,0.3)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatMon(v)}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="totalMon"
            stroke="#4ade80"
            strokeWidth={2}
            fill="url(#rewardGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
