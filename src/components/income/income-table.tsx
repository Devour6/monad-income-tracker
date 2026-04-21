"use client";

import { useState, useMemo } from "react";
import { Download, ArrowUpDown } from "lucide-react";

interface EpochIncome {
  epoch: number;
  epochSpan: number;
  poolRewardsMon: number;
  commissionMon: number;
  delegatorRewardsMon: number;
  poolRewardsUsd: number;
  commissionUsd: number;
  stakeMon: number;
  commissionPct: number;
  monPriceUsd: number;
  timestamp: string;
}

interface IncomeTableProps {
  data: EpochIncome[];
  loading: boolean;
}

type SortKey =
  | "epoch"
  | "epochSpan"
  | "poolRewardsMon"
  | "commissionMon"
  | "delegatorRewardsMon"
  | "commissionUsd";
type SortDir = "asc" | "desc";

function formatMon(n: number): string {
  if (!isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.001) return n.toFixed(4);
  return n.toFixed(6);
}

function formatUsd(n: number): string {
  if (!isFinite(n) || n === 0) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function exportCsv(data: EpochIncome[]) {
  const headers = [
    "Epoch",
    "Epoch Span",
    "Date",
    "Pool Rewards (MON)",
    "Commission (MON)",
    "Delegator Rewards (MON)",
    "Commission (USD)",
    "Stake (MON)",
    "Commission %",
    "MON Price (USD)",
  ];

  const rows = data.map((d) => [
    d.epoch,
    d.epochSpan,
    new Date(d.timestamp).toISOString().split("T")[0],
    d.poolRewardsMon,
    d.commissionMon,
    d.delegatorRewardsMon,
    d.commissionUsd,
    d.stakeMon,
    d.commissionPct,
    d.monPriceUsd,
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `monad-income-${data[0]?.epoch ?? "unknown"}-${data[data.length - 1]?.epoch ?? "unknown"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function IncomeTable({ data, loading }: IncomeTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("epoch");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const copy = [...data];
    copy.sort((a, b) => {
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return copy;
  }, [data, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  if (loading) {
    return (
      <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
        <div className="h-48 flex items-center justify-center">
          <div className="text-cream-20 text-sm font-body animate-pulse">
            Loading income data...
          </div>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl p-6">
        <div className="h-48 flex items-center justify-center">
          <div className="text-cream-20 text-sm font-body">
            No realized income data yet. Need at least 2 snapshots from the
            cron to compute deltas.
          </div>
        </div>
      </div>
    );
  }

  const columns: { key: SortKey; label: string; align: "left" | "right" }[] = [
    { key: "epoch", label: "Epoch", align: "left" },
    { key: "epochSpan", label: "Span", align: "right" },
    { key: "commissionMon", label: "Commission", align: "right" },
    { key: "commissionUsd", label: "Commission $", align: "right" },
    { key: "delegatorRewardsMon", label: "Delegator Payout", align: "right" },
    { key: "poolRewardsMon", label: "Pool Total", align: "right" },
  ];

  const totalCommission = data.reduce((s, d) => s + d.commissionMon, 0);
  const totalCommissionUsd = data.reduce((s, d) => s + d.commissionUsd, 0);
  const totalPool = data.reduce((s, d) => s + d.poolRewardsMon, 0);

  return (
    <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-cream-8">
        <h3 className="text-cream text-sm font-body font-medium uppercase tracking-wider">
          Realized Income by Snapshot
        </h3>
        <button
          onClick={() => exportCsv(data)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-body text-cream-40 bg-cream-8 hover:bg-cream-12 hover:text-cream-60 rounded-lg transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-cream-8">
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={`px-6 py-3 text-xs font-body font-medium uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-cream-60 ${
                    col.align === "right" ? "text-right" : "text-left"
                  } ${sortKey === col.key ? "text-cream-60" : "text-cream-20"}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>
              ))}
              <th className="px-6 py-3 text-xs font-body font-medium uppercase tracking-wider text-cream-20 text-right">
                Date
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={row.epoch}
                className={`border-b border-cream-5 transition-colors hover:bg-cream-8 ${
                  i % 2 === 0 ? "bg-transparent" : "bg-cream-3"
                }`}
              >
                <td className="px-6 py-3 text-sm font-mono text-cream-60">
                  {row.epoch}
                </td>
                <td className="px-6 py-3 text-sm font-mono text-cream-40 text-right">
                  {row.epochSpan}
                </td>
                <td className="px-6 py-3 text-sm font-mono text-phase-green text-right font-medium">
                  {formatMon(row.commissionMon)}
                </td>
                <td className="px-6 py-3 text-sm font-mono text-phase-green/70 text-right">
                  {formatUsd(row.commissionUsd)}
                </td>
                <td className="px-6 py-3 text-sm font-mono text-cream-40 text-right">
                  {formatMon(row.delegatorRewardsMon)}
                </td>
                <td className="px-6 py-3 text-sm font-mono text-cream-40 text-right">
                  {formatMon(row.poolRewardsMon)}
                </td>
                <td className="px-6 py-3 text-sm font-mono text-cream-20 text-right">
                  {new Date(row.timestamp).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer summary */}
      <div className="flex items-center justify-between px-6 py-3 border-t border-cream-8 bg-cream-3">
        <span className="text-cream-20 text-xs font-body">
          {data.length} snapshots
        </span>
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="text-cream-40">
            Commission:{" "}
            <span className="text-phase-green font-medium">
              {formatMon(totalCommission)} MON
            </span>
            {totalCommissionUsd > 0 && (
              <span className="text-phase-green/70 ml-1">
                ({formatUsd(totalCommissionUsd)})
              </span>
            )}
          </span>
          <span className="text-cream-40">
            Pool:{" "}
            <span className="text-cream-60 font-medium">
              {formatMon(totalPool)} MON
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
