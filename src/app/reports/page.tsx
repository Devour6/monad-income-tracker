"use client";

/**
 * /reports — network-wide commission leaderboard.
 *
 * Different lens from /validators/[id] (per-validator deep dive). This page
 * answers "across the whole network, who earned what?" — sortable, with
 * lifetime + claimed + unclaimed columns, mobile-friendly, CSV export.
 *
 * Per-validator date range / FX toggle / PDF live on /validators/[id].
 */

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { ArrowUpDown, FileDown, Search } from "lucide-react";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";

interface LeaderboardRow {
  validatorId: number;
  name: string;
  authAddress: string;
  stakeMon: number;
  commissionPct: number;
  totalCommissionMon: number;
  totalCommissionUsd: number;
  currentUnclaimedMon: number;
  currentUnclaimedUsd: number;
  totalClaimedMon: number;
  totalClaimedUsd: number;
  claimCount: number;
}

interface LeaderboardResp {
  window: { firstEpoch: number; lastEpoch: number; daysObserved: number };
  validators: LeaderboardRow[];
  count: number;
}

type SortKey =
  | "totalCommissionMon"
  | "currentUnclaimedMon"
  | "totalClaimedMon"
  | "stakeMon"
  | "commissionPct"
  | "claimCount";

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "totalCommissionMon", label: "Lifetime" },
  { key: "totalClaimedMon", label: "Claimed" },
  { key: "currentUnclaimedMon", label: "Unclaimed" },
  { key: "claimCount", label: "Claims" },
  { key: "stakeMon", label: "Stake" },
  { key: "commissionPct", label: "Comm" },
];

function fmtMon(n: number): string {
  if (!isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function fmtUsd(n: number): string {
  if (!isFinite(n) || n <= 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function ReportsPage() {
  const [data, setData] = useState<LeaderboardResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("totalCommissionMon");
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/realized/leaderboard?limit=250")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setErr(d.error);
        else setData(d);
      })
      .catch((e) => !cancelled && setErr(String(e)));
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
            String(v.validatorId).includes(q)
        )
      : data.validators;
    return [...rows].sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number;
      const bv = (b[sortKey] ?? 0) as number;
      if (av === bv) return a.name.localeCompare(b.name);
      return sortDesc ? bv - av : av - bv;
    });
  }, [data, query, sortKey, sortDesc]);

  // Network totals
  const totals = useMemo(() => {
    if (!data) return null;
    const t = {
      lifetime: 0,
      claimed: 0,
      unclaimed: 0,
      claimCount: 0,
      withIncome: 0,
    };
    for (const v of data.validators) {
      if (v.totalCommissionMon > 0) t.withIncome += 1;
      t.lifetime += v.totalCommissionMon;
      t.claimed += v.totalClaimedMon;
      t.unclaimed += v.currentUnclaimedMon;
      t.claimCount += v.claimCount;
    }
    return t;
  }, [data]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDesc(!sortDesc);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  }

  function downloadCsv() {
    if (!data) return;
    const header = [
      "validatorId",
      "name",
      "authAddress",
      "stakeMon",
      "commissionPct",
      "totalCommissionMon",
      "totalCommissionUsd",
      "totalClaimedMon",
      "currentUnclaimedMon",
      "claimCount",
    ];
    const rows = filtered.map((v) => [
      v.validatorId,
      `"${(v.name || "").replace(/"/g, '""')}"`,
      v.authAddress,
      v.stakeMon,
      v.commissionPct,
      v.totalCommissionMon.toFixed(8),
      v.totalCommissionUsd.toFixed(2),
      v.totalClaimedMon.toFixed(8),
      v.currentUnclaimedMon.toFixed(8),
      v.claimCount,
    ]);
    const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monad-validator-commissions-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="relative z-[1] min-h-screen px-4 sm:px-6 pt-8 sm:pt-10 pb-6">
      <AuroraBg />
      <FloatingParticles />

      <div className="max-w-[1100px] mx-auto">
        {/* Top bar */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-8 sm:mb-12 opacity-0 animate-fade-in-up">
          <Link href="/" className="flex items-center gap-3">
            <h1 className="font-display text-lg sm:text-xl text-cream tracking-[0.04em]">
              Monad Income Tracker
            </h1>
          </Link>
          <nav className="flex items-center gap-1 -mx-1 sm:mx-0">
            {[
              { href: "/methodology", label: "Methodology" },
              { href: "/sdk", label: "API" },
              { href: "/docs", label: "Docs" },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-xs font-body text-cream-40 hover:text-cream transition-colors px-3 py-1.5 rounded-md hover:bg-cream-5"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </header>

        <header className="mb-6 sm:mb-8 pb-5 sm:pb-6 border-b border-cream-8">
          <h2 className="font-display text-2xl sm:text-3xl text-cream tracking-[0.02em] mb-2">
            Network commission leaderboard
          </h2>
          <p className="font-body text-cream-60 text-sm leading-relaxed">
            Realized lifetime commission for every validator. Click any row for
            their full dashboard with date range, FX toggle, and per-epoch CSV
            export.
          </p>
        </header>

        {err && (
          <div className="text-center py-12 text-cream-60 text-sm font-body">
            <div className="font-medium mb-2">Couldn&apos;t load leaderboard</div>
            <div className="text-cream-40 text-xs">{err}</div>
          </div>
        )}

        {!err && !data && (
          <div className="text-center py-12 text-cream-40 text-sm font-body animate-pulse">
            Loading…
          </div>
        )}

        {data && totals && (
          <>
            {/* Network totals */}
            <section className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              <div className="rounded-lg border border-phase-green/30 bg-phase-green/5 p-3 sm:p-4">
                <div className="text-[10px] font-body uppercase tracking-widest text-phase-green">
                  Network lifetime
                </div>
                <div className="font-display text-xl sm:text-2xl text-cream mt-1">
                  {fmtMon(totals.lifetime)} MON
                </div>
              </div>
              <div className="rounded-lg border border-cream-8 bg-cream-5 p-3 sm:p-4">
                <div className="text-[10px] font-body uppercase tracking-widest text-cream-40">
                  Claimed
                </div>
                <div className="font-display text-xl sm:text-2xl text-cream mt-1">
                  {fmtMon(totals.claimed)} MON
                </div>
                <div className="text-[10px] font-body text-cream-40 mt-0.5">
                  {totals.claimCount} events
                </div>
              </div>
              <div className="rounded-lg border border-cream-8 bg-cream-5 p-3 sm:p-4">
                <div className="text-[10px] font-body uppercase tracking-widest text-cream-40">
                  Unclaimed
                </div>
                <div className="font-display text-xl sm:text-2xl text-cream mt-1">
                  {fmtMon(totals.unclaimed)} MON
                </div>
              </div>
              <div className="rounded-lg border border-cream-8 bg-cream-5 p-3 sm:p-4">
                <div className="text-[10px] font-body uppercase tracking-widest text-cream-40">
                  Validators
                </div>
                <div className="font-display text-xl sm:text-2xl text-cream mt-1">
                  {totals.withIncome}/{data.count}
                </div>
                <div className="text-[10px] font-body text-cream-40 mt-0.5">
                  with income
                </div>
              </div>
            </section>

            {/* Search + export */}
            <section className="mb-4 flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex-1 flex items-center gap-2 rounded-md border border-cream-12 bg-cream-5 px-3 py-2">
                <Search className="w-3.5 h-3.5 text-cream-40 shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, address, or validator ID"
                  className="flex-1 bg-transparent text-cream text-xs font-body outline-none placeholder:text-cream-40"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    className="text-cream-40 hover:text-cream text-[10px] font-body"
                  >
                    clear
                  </button>
                )}
                <span className="text-[10px] font-body text-cream-40 shrink-0">
                  {filtered.length}
                </span>
              </div>
              <button
                onClick={downloadCsv}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-body text-phase-green bg-phase-green/10 border border-phase-green/30 rounded-md hover:bg-phase-green/15 transition-all whitespace-nowrap"
              >
                <FileDown className="w-3.5 h-3.5" />
                Download CSV
              </button>
            </section>

            {/* Window note */}
            <div className="text-[10px] font-body text-cream-40 mb-3">
              Tracking from epoch {data.window.firstEpoch} ·{" "}
              {data.window.daysObserved.toFixed(1)} days observed
            </div>

            {/* Table — horizontal scroll on mobile */}
            <section className="rounded-xl border border-cream-12 bg-cream-5 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-body min-w-[760px]">
                  <thead className="bg-cream-5">
                    <tr className="text-cream-40 text-[10px] uppercase tracking-widest border-b border-cream-12">
                      <th className="text-left px-3 sm:px-4 py-3 font-body">
                        Validator
                      </th>
                      {COLUMNS.map((c) => (
                        <th
                          key={c.key}
                          className="text-right px-3 sm:px-4 py-3 font-body"
                        >
                          <button
                            onClick={() => toggleSort(c.key)}
                            className={`inline-flex items-center gap-1 transition-colors ${
                              sortKey === c.key
                                ? "text-phase-green"
                                : "hover:text-cream"
                            }`}
                          >
                            {c.label}
                            <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((v, i) => (
                      <tr
                        key={v.validatorId}
                        className={`border-t border-cream-8 ${
                          i % 2 === 0 ? "bg-transparent" : "bg-cream-5/40"
                        }`}
                      >
                        <td className="px-3 sm:px-4 py-2.5">
                          <Link
                            href={`/validators/${v.validatorId}`}
                            className="block hover:text-phase-green transition-colors"
                          >
                            <div className="text-cream text-xs font-body font-medium truncate">
                              {v.name}
                            </div>
                            <div className="text-cream-40 text-[10px] font-mono">
                              #{v.validatorId}
                            </div>
                          </Link>
                        </td>
                        <td className="px-3 sm:px-4 py-2.5 text-right">
                          <div className="text-cream font-mono">
                            {fmtMon(v.totalCommissionMon)}
                          </div>
                          <div className="text-cream-40 text-[10px] font-mono">
                            {fmtUsd(v.totalCommissionUsd)}
                          </div>
                        </td>
                        <td className="px-3 sm:px-4 py-2.5 text-right text-cream-60 font-mono">
                          {fmtMon(v.totalClaimedMon)}
                        </td>
                        <td className="px-3 sm:px-4 py-2.5 text-right text-cream-60 font-mono">
                          {fmtMon(v.currentUnclaimedMon)}
                        </td>
                        <td className="px-3 sm:px-4 py-2.5 text-right text-cream-60 font-mono">
                          {v.claimCount}
                        </td>
                        <td className="px-3 sm:px-4 py-2.5 text-right text-cream-60 font-mono">
                          {fmtMon(v.stakeMon)}
                        </td>
                        <td className="px-3 sm:px-4 py-2.5 text-right text-cream-60 font-mono">
                          {v.commissionPct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="mt-4 text-[10px] font-body text-cream-40 text-center">
              Click any validator for their full dashboard with date range, FX
              toggle, and per-epoch CSV export.
            </div>
          </>
        )}

        <Footer />
      </div>
    </div>
  );
}
