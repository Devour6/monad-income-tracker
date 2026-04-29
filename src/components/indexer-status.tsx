"use client";

import { useEffect, useState } from "react";

interface Status {
  cursor: { lastBlock: string; lastEpoch: number | null } | null;
  chainHead: string | null;
  lagBlocks: number | null;
  totals: {
    blocksIndexed: number;
    epochsCovered: number;
    totalPriorityFeesMon: number;
  } | null;
  coverage: { mapped: number; unmapped: number; ratio: number | null };
}

function formatLag(blocks: number | null): { label: string; tone: string } {
  if (blocks == null) return { label: "—", tone: "text-cream-40" };
  if (blocks < 60) return { label: `${blocks}s behind`, tone: "text-phase-green" };
  if (blocks < 300) return { label: `${blocks}s behind`, tone: "text-phase-green" };
  if (blocks < 1800)
    return { label: `${(blocks / 60).toFixed(0)}m behind`, tone: "text-yellow-300" };
  if (blocks < 14400)
    return { label: `${(blocks / 60).toFixed(0)}m behind`, tone: "text-yellow-300" };
  return {
    label: `${(blocks / 3600).toFixed(1)}h behind`,
    tone: "text-orange-300",
  };
}

function formatMon(n: number): string {
  if (!isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

export function IndexerStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/indexer/status");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Status;
        if (!cancelled) setStatus(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "fetch failed");
      }
    }
    load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (error) {
    return (
      <div className="bg-cream-5 border border-cream-8 rounded-xl p-4 text-cream-40 text-xs font-body">
        Indexer status unavailable
      </div>
    );
  }
  if (!status) {
    return (
      <div className="bg-cream-5 border border-cream-8 rounded-xl p-4 text-cream-40 text-xs font-body animate-pulse">
        Loading indexer status…
      </div>
    );
  }

  const lag = formatLag(status.lagBlocks);
  const coveragePct =
    status.coverage.ratio != null
      ? `${(status.coverage.ratio * 100).toFixed(0)}%`
      : "—";

  return (
    <div className="bg-cream-5 border border-cream-8 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="relative flex h-2 w-2">
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
              status.lagBlocks != null && status.lagBlocks < 1800
                ? "bg-phase-green"
                : "bg-yellow-400"
            }`}
          />
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${
              status.lagBlocks != null && status.lagBlocks < 1800
                ? "bg-phase-green"
                : "bg-yellow-400"
            }`}
          />
        </span>
        <span className="text-cream text-xs font-body uppercase tracking-wider">
          Live Block Indexer
        </span>
        <span className={`text-xs font-mono ml-auto ${lag.tone}`}>
          {lag.label}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <div className="text-cream-40 uppercase tracking-wider mb-1">
            Cursor
          </div>
          <div className="text-cream font-mono">
            {status.cursor
              ? `#${status.cursor.lastBlock}`
              : "—"}
          </div>
          {status.cursor?.lastEpoch != null && (
            <div className="text-cream-40 mt-0.5">
              epoch {status.cursor.lastEpoch}
            </div>
          )}
        </div>
        <div>
          <div className="text-cream-40 uppercase tracking-wider mb-1">
            Blocks Indexed
          </div>
          <div className="text-cream font-mono">
            {status.totals
              ? status.totals.blocksIndexed.toLocaleString()
              : "—"}
          </div>
          <div className="text-cream-40 mt-0.5">
            {status.totals?.epochsCovered ?? 0} epochs
          </div>
        </div>
        <div>
          <div className="text-cream-40 uppercase tracking-wider mb-1">
            Priority Fees
          </div>
          <div className="text-cream font-mono">
            {status.totals
              ? `${formatMon(status.totals.totalPriorityFeesMon)} MON`
              : "—"}
          </div>
          <div className="text-cream-40 mt-0.5">total indexed</div>
        </div>
        <div>
          <div className="text-cream-40 uppercase tracking-wider mb-1">
            Miner Coverage
          </div>
          <div className="text-cream font-mono">{coveragePct}</div>
          <div className="text-cream-40 mt-0.5">
            {status.coverage.mapped}/{status.coverage.mapped + status.coverage.unmapped}
          </div>
        </div>
      </div>
    </div>
  );
}
