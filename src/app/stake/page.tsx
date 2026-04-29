"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpDown, Search, Info } from "lucide-react";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";
import { formatStake, formatApy } from "@/lib/apy";

interface LeaderboardRow {
  validatorId: number;
  name: string;
  authAddress: string;
  stakeMon: number;
  commissionPct: number;
  selfStakeMon: number | null;
  poolApy: number | null;
  delegatorApy: number | null;
  blocksProposed: number;
  priorityFeesMon: number;
  productionEfficiency: number | null;
}

interface LeaderboardResp {
  window: {
    earliestEpoch: number;
    latestEpoch: number;
    epochSpan: number;
    approxDays: number;
  };
  validators: LeaderboardRow[];
  count: number;
}

type SortKey =
  | "delegatorApy"
  | "poolApy"
  | "stakeMon"
  | "commissionPct"
  | "productionEfficiency"
  | "blocksProposed"
  | "selfStakeMon";

const COLUMNS: { key: SortKey; label: string; help?: string }[] = [
  { key: "delegatorApy", label: "Delegator APY", help: "Pool APY × (1 − commission). What you actually net." },
  { key: "poolApy", label: "Pool APY", help: "Gross pool yield before commission." },
  { key: "commissionPct", label: "Commission", help: "Validator's cut of pool rewards." },
  { key: "productionEfficiency", label: "Block Eff", help: "Actual / expected blocks based on stake share. 1.0 = on-pace." },
  { key: "blocksProposed", label: "Blocks", help: "Blocks proposed in the recent window." },
  { key: "stakeMon", label: "Total Stake" },
  { key: "selfStakeMon", label: "Self-Stake", help: "Validator's own skin in the game." },
];

export default function StakePage() {
  const [data, setData] = useState<LeaderboardResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("delegatorApy");
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/leaderboard?lookback=7")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setErr(d.error);
        else setData(d);
      })
      .catch((e) => !cancelled && setErr(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const rows = q
      ? data.validators.filter(
          (v) =>
            v.name.toLowerCase().includes(q) ||
            v.authAddress.toLowerCase().includes(q) ||
            String(v.validatorId).includes(q),
        )
      : data.validators;

    const sorted = [...rows].sort((a, b) => {
      const av = (a[sortKey] ?? -Infinity) as number;
      const bv = (b[sortKey] ?? -Infinity) as number;
      if (av === bv) return a.name.localeCompare(b.name);
      return sortDesc ? bv - av : av - bv;
    });
    return sorted;
  }, [data, query, sortKey, sortDesc]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDesc((d) => !d);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  }

  return (
    <div className="relative min-h-screen bg-dark text-cream overflow-hidden">
      <AuroraBg />
      <FloatingParticles />

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-cream-40 hover:text-cream text-sm font-body mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        <h1 className="font-display text-3xl text-cream tracking-wide">
          Choose a Validator
        </h1>
        <p className="text-cream-60 text-sm font-body mt-2 max-w-2xl leading-relaxed">
          Sortable leaderboard of every active Monad validator with realized
          delegator APY, commission rate, recent block production, and stake.
          All numbers are derived from on-chain data over the most recent
          window we have indexed — no projections.
        </p>

        {data && (
          <div className="mt-3 text-cream-40 text-xs font-body">
            Window: epochs {data.window.earliestEpoch}–{data.window.latestEpoch} ·{" "}
            {data.window.approxDays.toFixed(1)} days · {data.count}{" "}
            validators with data
          </div>
        )}

        <div className="mt-6 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="w-4 h-4 text-cream-40 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, address, or ID…"
              className="w-full pl-9 pr-3 py-2.5 bg-cream-5 border border-cream-8 rounded-lg text-sm font-body text-cream placeholder:text-cream-40 focus:outline-none focus:border-phase-green/50"
            />
          </div>
          <div className="text-cream-20 text-[11px] font-body flex items-center gap-1.5">
            <Info className="w-3 h-3" />
            Click a column header to sort
          </div>
        </div>

        {err && (
          <div className="mt-6 bg-red-500/10 border border-red-500/30 text-red-300 text-sm font-body p-4 rounded-lg">
            {err}
          </div>
        )}

        {loading && (
          <div className="mt-6 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-12 bg-cream-5 rounded-lg animate-pulse"
              />
            ))}
          </div>
        )}

        {!loading && !err && data && (
          <div className="mt-6 bg-cream-5 border border-cream-8 rounded-xl overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="text-cream-40 text-[10px] uppercase tracking-wider border-b border-cream-8">
                  <th className="text-left py-3 px-4 font-normal">Validator</th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className="text-right py-3 px-4 font-normal cursor-pointer hover:text-cream"
                      onClick={() => toggleSort(c.key)}
                      title={c.help}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        <ArrowUpDown
                          className={`w-3 h-3 ${sortKey === c.key ? "text-phase-green" : "opacity-40"}`}
                        />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => {
                  const eff = v.productionEfficiency;
                  const effColor =
                    eff == null
                      ? "text-cream-20"
                      : eff >= 1.0
                        ? "text-phase-green"
                        : eff >= 0.85
                          ? "text-cream-60"
                          : "text-red-400";
                  return (
                    <tr
                      key={v.validatorId}
                      className="border-b border-cream-8 last:border-0 hover:bg-cream-5"
                    >
                      <td className="py-3 px-4">
                        <Link
                          href={`/validators/${v.validatorId}`}
                          className="text-cream hover:text-phase-green"
                        >
                          {v.name}
                        </Link>
                        <div className="text-cream-40 text-[10px] font-mono">
                          #{v.validatorId} · {v.authAddress.slice(0, 6)}…{v.authAddress.slice(-4)}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right text-cream font-medium">
                        {v.delegatorApy != null
                          ? formatApy(v.delegatorApy)
                          : "—"}
                      </td>
                      <td className="py-3 px-4 text-right text-cream-60">
                        {v.poolApy != null ? formatApy(v.poolApy) : "—"}
                      </td>
                      <td className="py-3 px-4 text-right text-cream-60">
                        {v.commissionPct.toFixed(2)}%
                      </td>
                      <td className={`py-3 px-4 text-right ${effColor}`}>
                        {eff != null ? eff.toFixed(2) : "—"}
                      </td>
                      <td className="py-3 px-4 text-right text-cream-60">
                        {v.blocksProposed > 0
                          ? v.blocksProposed.toLocaleString()
                          : "—"}
                      </td>
                      <td className="py-3 px-4 text-right text-cream-60">
                        {formatStake(v.stakeMon)}
                      </td>
                      <td className="py-3 px-4 text-right text-cream-60">
                        {v.selfStakeMon != null
                          ? formatStake(v.selfStakeMon)
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={COLUMNS.length + 1}
                      className="text-cream-40 text-center py-12 text-xs"
                    >
                      No validators match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <Footer />
      </div>
    </div>
  );
}
