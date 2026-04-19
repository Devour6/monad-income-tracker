"use client";

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { ArrowLeft, Search, X, Server, ChevronDown, Users } from "lucide-react";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";
import { ScrollReveal } from "@/components/scroll-reveal";
import { formatMon, formatStake, formatApy } from "@/lib/apy";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ValidatorListItem {
  validatorId: number;
  name: string;
  authAddress: string;
  stakeMon: number;
  commissionPct: number;
  lastEpoch: number;
}

interface StakeHistoryPoint {
  epoch: number;
  stakeMon: number;
}

interface CompareValidator {
  validatorId: number;
  name: string;
  stakeMon: number;
  commissionPct: number;
  apy: number;
  totalIncomeMon: number;
  epochsAnalyzed: number;
  stakeHistory: StakeHistoryPoint[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MAX_COMPARE = 5;
const LINE_COLORS = ["#4ade80", "#818cf8", "#f59e0b", "#ec4899", "#06b6d4"];

/* ------------------------------------------------------------------ */
/*  Skeleton helpers                                                   */
/* ------------------------------------------------------------------ */

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-6 py-4">
      <div className="h-4 w-24 bg-cream-8 rounded animate-pulse" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-4 w-20 bg-cream-8 rounded animate-pulse ml-auto first:ml-0"
        />
      ))}
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="bg-cream-5 border border-cream-8 rounded-xl overflow-hidden">
      {Array.from({ length: 7 }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

function SkeletonChart() {
  return (
    <div className="mt-8 bg-cream-5 border border-cream-8 rounded-xl p-6">
      <div className="h-[320px] flex items-center justify-center">
        <div className="text-cream-20 text-sm font-body animate-pulse">
          Loading chart data...
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Chart tooltip                                                      */
/* ------------------------------------------------------------------ */

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-dark border border-cream-12 rounded-lg px-4 py-3 shadow-xl">
      <div className="text-cream text-xs font-body font-medium mb-2">
        Epoch {label}
      </div>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs mb-1 last:mb-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-cream-60 truncate max-w-[140px]">{entry.name}</span>
          <span className="text-cream font-mono ml-auto">
            {formatStake(entry.value)} MON
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Utility: determine best value per metric                           */
/* ------------------------------------------------------------------ */

type MetricKey = "stakeMon" | "commissionPct" | "apy" | "totalIncomeMon" | "epochsAnalyzed";

function bestValues(validators: CompareValidator[]): Record<MetricKey, number | null> {
  if (validators.length < 2) {
    return {
      stakeMon: null,
      commissionPct: null,
      apy: null,
      totalIncomeMon: null,
      epochsAnalyzed: null,
    };
  }

  return {
    stakeMon: Math.max(...validators.map((v) => v.stakeMon)),
    // Lower commission is better
    commissionPct: Math.min(...validators.map((v) => v.commissionPct)),
    apy: Math.max(...validators.map((v) => v.apy)),
    totalIncomeMon: Math.max(...validators.map((v) => v.totalIncomeMon)),
    epochsAnalyzed: Math.max(...validators.map((v) => v.epochsAnalyzed)),
  };
}

/* ------------------------------------------------------------------ */
/*  Main compare content (uses useSearchParams)                        */
/* ------------------------------------------------------------------ */

function CompareContent() {
  const searchParams = useSearchParams();

  /* ---------- state ---------- */
  const [allValidators, setAllValidators] = useState<ValidatorListItem[]>([]);
  const [selected, setSelected] = useState<ValidatorListItem[]>([]);
  const [compareData, setCompareData] = useState<CompareValidator[]>([]);
  const [loadingValidators, setLoadingValidators] = useState(true);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [initialIdsProcessed, setInitialIdsProcessed] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  /* ---------- fetch all validators ---------- */
  useEffect(() => {
    fetch("/api/validators")
      .then((r) => r.json())
      .then((data) => {
        if (data.validators) {
          setAllValidators(data.validators);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingValidators(false));
  }, []);

  /* ---------- auto-select from query params ---------- */
  useEffect(() => {
    if (initialIdsProcessed || allValidators.length === 0) return;

    const idsParam = searchParams.get("ids");
    if (idsParam) {
      const ids = idsParam
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0)
        .slice(0, MAX_COMPARE);

      const matched = ids
        .map((id) => allValidators.find((v) => v.validatorId === id))
        .filter((v): v is ValidatorListItem => v !== undefined);

      if (matched.length > 0) {
        setSelected(matched);
      }
    }
    setInitialIdsProcessed(true);
  }, [allValidators, searchParams, initialIdsProcessed]);

  /* ---------- fetch comparison data ---------- */
  const fetchComparison = useCallback(async (ids: number[]) => {
    if (ids.length < 2) {
      setCompareData([]);
      return;
    }
    setLoadingCompare(true);
    try {
      const res = await fetch(`/api/compare?ids=${ids.join(",")}`);
      const data = await res.json();
      if (data.validators) {
        setCompareData(data.validators);
      } else {
        setCompareData([]);
      }
    } catch {
      setCompareData([]);
    } finally {
      setLoadingCompare(false);
    }
  }, []);

  useEffect(() => {
    const ids = selected.map((v) => v.validatorId);
    fetchComparison(ids);
  }, [selected, fetchComparison]);

  /* ---------- update URL when selection changes ---------- */
  useEffect(() => {
    if (!initialIdsProcessed) return;
    const ids = selected.map((v) => v.validatorId).join(",");
    const url = ids ? `?ids=${ids}` : "";
    window.history.replaceState(null, "", `/compare${url}`);
  }, [selected, initialIdsProcessed]);

  /* ---------- close dropdown on outside click ---------- */
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  /* ---------- focus search input when dropdown opens ---------- */
  useEffect(() => {
    if (dropdownOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [dropdownOpen]);

  /* ---------- handlers ---------- */
  function addValidator(v: ValidatorListItem) {
    if (selected.length >= MAX_COMPARE) return;
    if (selected.some((s) => s.validatorId === v.validatorId)) return;
    setSelected((prev) => [...prev, v]);
    setSearchQuery("");
  }

  function removeValidator(id: number) {
    setSelected((prev) => prev.filter((v) => v.validatorId !== id));
  }

  /* ---------- filtered dropdown list ---------- */
  const filteredValidators = useMemo(() => {
    const selectedIds = new Set(selected.map((v) => v.validatorId));
    return allValidators.filter((v) => {
      if (selectedIds.has(v.validatorId)) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        v.name.toLowerCase().includes(q) ||
        v.authAddress.toLowerCase().includes(q) ||
        v.validatorId.toString().includes(q)
      );
    });
  }, [allValidators, selected, searchQuery]);

  /* ---------- chart data: merge stake histories ---------- */
  const chartData = useMemo(() => {
    if (compareData.length < 2) return [];

    // Collect all epochs across all validators, build a map
    const epochMap = new Map<number, Record<string, number>>();

    for (const v of compareData) {
      // stakeHistory comes newest-first, reverse for chronological order
      const history = [...v.stakeHistory].reverse();
      for (const point of history) {
        const existing = epochMap.get(point.epoch) || { epoch: point.epoch };
        existing[v.name] = point.stakeMon;
        epochMap.set(point.epoch, existing);
      }
    }

    // Sort by epoch ascending
    return Array.from(epochMap.values()).sort(
      (a, b) => (a.epoch as number) - (b.epoch as number)
    );
  }, [compareData]);

  /* ---------- best values for highlighting ---------- */
  const best = useMemo(() => bestValues(compareData), [compareData]);

  /* ---------- row definitions for the comparison table ---------- */
  const metricRows: {
    label: string;
    key: MetricKey;
    format: (v: CompareValidator) => string;
  }[] = [
    {
      label: "Stake",
      key: "stakeMon",
      format: (v) => `${formatMon(v.stakeMon)} MON`,
    },
    {
      label: "Commission",
      key: "commissionPct",
      format: (v) => `${v.commissionPct}%`,
    },
    {
      label: "APY",
      key: "apy",
      format: (v) => formatApy(v.apy),
    },
    {
      label: "Total Income",
      key: "totalIncomeMon",
      format: (v) => `${formatMon(v.totalIncomeMon)} MON`,
    },
    {
      label: "Epochs Analyzed",
      key: "epochsAnalyzed",
      format: (v) => v.epochsAnalyzed.toString(),
    },
  ];

  function isBest(key: MetricKey, value: number): boolean {
    if (best[key] === null) return false;
    return value === best[key];
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <>
      {/* Validator selector */}
      <ScrollReveal delay={0}>
        <div
          ref={dropdownRef}
          className="relative w-full max-w-2xl mx-auto mb-8"
        >
          {/* Selected chips */}
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {selected.map((v, i) => (
                <span
                  key={v.validatorId}
                  className="inline-flex items-center gap-2 bg-cream-5 border border-cream-8 rounded-full pl-3 pr-2 py-1.5 text-sm font-body"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: LINE_COLORS[i % LINE_COLORS.length] }}
                  />
                  <span className="text-cream">{v.name}</span>
                  <span className="text-cream-20 text-xs font-mono">
                    #{v.validatorId}
                  </span>
                  <button
                    onClick={() => removeValidator(v.validatorId)}
                    className="ml-1 p-0.5 rounded-full hover:bg-cream-12 transition-colors"
                    aria-label={`Remove ${v.name}`}
                  >
                    <X className="w-3.5 h-3.5 text-cream-40 hover:text-cream" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Search trigger */}
          <button
            onClick={() => {
              if (selected.length < MAX_COMPARE) {
                setDropdownOpen(!dropdownOpen);
              }
            }}
            disabled={selected.length >= MAX_COMPARE}
            className={`w-full flex items-center gap-3 bg-cream-5 border border-cream-8 rounded-xl px-4 py-3 text-left transition-colors ${
              selected.length >= MAX_COMPARE
                ? "opacity-50 cursor-not-allowed"
                : "hover:border-cream-12"
            }`}
          >
            <Search className="w-4 h-4 text-cream-40 shrink-0" />
            <span className="flex-1 text-cream-40 text-sm font-body">
              {loadingValidators
                ? "Loading validators..."
                : selected.length >= MAX_COMPARE
                  ? `Maximum of ${MAX_COMPARE} validators selected`
                  : "Search validators to compare..."}
            </span>
            <ChevronDown
              className={`w-4 h-4 text-cream-20 shrink-0 transition-transform ${
                dropdownOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {/* Dropdown */}
          {dropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-dark border border-cream-8 rounded-xl overflow-hidden shadow-2xl z-50">
              {/* Search input */}
              <div className="p-3 border-b border-cream-8">
                <div className="flex items-center gap-2 bg-cream-5 rounded-lg px-3 py-2">
                  <Search className="w-4 h-4 text-cream-40" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name, address, or ID..."
                    className="flex-1 bg-transparent text-cream text-sm font-body outline-none placeholder:text-cream-20"
                  />
                </div>
              </div>

              {/* Validator list */}
              <div className="max-h-72 overflow-y-auto">
                {filteredValidators.length === 0 ? (
                  <div className="text-center py-8 text-cream-20 text-sm font-body">
                    {allValidators.length === 0
                      ? "No validators available"
                      : "No matching validators"}
                  </div>
                ) : (
                  filteredValidators.map((v) => (
                    <button
                      key={v.validatorId}
                      onClick={() => {
                        addValidator(v);
                        if (selected.length + 1 >= MAX_COMPARE) {
                          setDropdownOpen(false);
                        }
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-cream-5 transition-colors"
                    >
                      <Server className="w-4 h-4 text-cream-20 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-cream text-sm font-body font-medium truncate">
                            {v.name}
                          </span>
                          <span className="text-cream-20 text-xs font-mono shrink-0">
                            #{v.validatorId}
                          </span>
                        </div>
                        <div className="text-cream-20 text-xs font-mono truncate mt-0.5">
                          {v.authAddress}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-cream-40 text-xs font-body">
                          {formatStake(v.stakeMon)} MON
                        </div>
                        <div className="text-cream-20 text-xs font-body">
                          {v.commissionPct}% fee
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </ScrollReveal>

      {/* Empty state */}
      {selected.length < 2 && !loadingCompare && (
        <div className="text-center py-16 text-cream-20 text-sm font-body">
          {selected.length === 0
            ? "Select at least 2 validators to compare"
            : "Select one more validator to start comparison"}
        </div>
      )}

      {/* Loading state */}
      {loadingCompare && (
        <>
          <ScrollReveal delay={100}>
            <SkeletonTable />
          </ScrollReveal>
          <ScrollReveal delay={200}>
            <SkeletonChart />
          </ScrollReveal>
        </>
      )}

      {/* Comparison results */}
      {!loadingCompare && compareData.length >= 2 && (
        <>
          {/* Desktop: table layout */}
          <ScrollReveal delay={100}>
            <div className="hidden md:block bg-cream-5 border border-cream-8 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-cream-8">
                    <th className="px-6 py-4 text-left text-cream-20 text-xs font-body uppercase tracking-wider w-40">
                      Metric
                    </th>
                    {compareData.map((v, i) => (
                      <th
                        key={v.validatorId}
                        className="px-6 py-4 text-center"
                      >
                        <div className="flex items-center justify-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{
                              backgroundColor:
                                LINE_COLORS[i % LINE_COLORS.length],
                            }}
                          />
                          <Link
                            href={`/validators/${v.validatorId}`}
                            className="text-cream text-sm font-body font-medium hover:text-phase-green transition-colors"
                          >
                            {v.name}
                          </Link>
                        </div>
                        <span className="text-cream-20 text-xs font-mono">
                          #{v.validatorId}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metricRows.map((row) => (
                    <tr
                      key={row.key}
                      className="border-b border-cream-5 hover:bg-cream-8 transition-colors"
                    >
                      <td className="px-6 py-4 text-cream-20 text-xs font-body uppercase tracking-wider">
                        {row.label}
                      </td>
                      {compareData.map((v) => {
                        const highlighted = isBest(row.key, v[row.key]);
                        return (
                          <td
                            key={v.validatorId}
                            className={`px-6 py-4 text-center font-mono text-sm ${
                              highlighted
                                ? "text-phase-green font-medium"
                                : "text-cream"
                            }`}
                          >
                            {row.format(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ScrollReveal>

          {/* Mobile: card layout */}
          <ScrollReveal delay={100}>
            <div className="md:hidden space-y-4">
              {compareData.map((v, i) => (
                <div
                  key={v.validatorId}
                  className="bg-cream-5 border border-cream-8 rounded-xl p-5 card-hover"
                >
                  {/* Card header */}
                  <div className="flex items-center gap-2 mb-4 pb-3 border-b border-cream-8">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          LINE_COLORS[i % LINE_COLORS.length],
                      }}
                    />
                    <Link
                      href={`/validators/${v.validatorId}`}
                      className="text-cream text-sm font-body font-medium hover:text-phase-green transition-colors"
                    >
                      {v.name}
                    </Link>
                    <span className="text-cream-20 text-xs font-mono">
                      #{v.validatorId}
                    </span>
                  </div>

                  {/* Card metrics */}
                  <div className="grid grid-cols-2 gap-3">
                    {metricRows.map((row) => {
                      const highlighted = isBest(row.key, v[row.key]);
                      return (
                        <div key={row.key}>
                          <div className="text-cream-20 text-xs font-body uppercase tracking-wider mb-1">
                            {row.label}
                          </div>
                          <div
                            className={`font-mono text-sm ${
                              highlighted
                                ? "text-phase-green font-medium"
                                : "text-cream"
                            }`}
                          >
                            {row.format(v)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ScrollReveal>

          {/* Stake history comparison chart */}
          {chartData.length > 0 && (
            <ScrollReveal delay={200}>
              <div className="mt-8 bg-cream-5 border border-cream-8 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-cream text-sm font-body font-medium uppercase tracking-wider">
                    Stake History Comparison
                  </h3>
                </div>

                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(243,238,217,0.04)"
                    />
                    <XAxis
                      dataKey="epoch"
                      tick={{
                        fill: "rgba(243,238,217,0.3)",
                        fontSize: 11,
                      }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{
                        fill: "rgba(243,238,217,0.3)",
                        fontSize: 11,
                      }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => formatStake(v)}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{
                        paddingTop: "12px",
                        fontSize: "12px",
                        fontFamily: "var(--font-body)",
                      }}
                      formatter={(value: string) => (
                        <span className="text-cream-60 text-xs">
                          {value}
                        </span>
                      )}
                    />
                    {compareData.map((v, i) => (
                      <Line
                        key={v.validatorId}
                        type="monotone"
                        dataKey={v.name}
                        stroke={LINE_COLORS[i % LINE_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{
                          r: 4,
                          fill: LINE_COLORS[i % LINE_COLORS.length],
                          stroke: "#0F0E0C",
                          strokeWidth: 2,
                        }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ScrollReveal>
          )}

          {/* No chart data fallback */}
          {chartData.length === 0 && compareData.length >= 2 && (
            <ScrollReveal delay={200}>
              <div className="mt-8 bg-cream-5 border border-cream-8 rounded-xl p-6">
                <div className="h-48 flex items-center justify-center">
                  <div className="text-cream-20 text-sm font-body">
                    No stake history data available for charting
                  </div>
                </div>
              </div>
            </ScrollReveal>
          )}
        </>
      )}

      {/* No comparison data after fetch */}
      {!loadingCompare &&
        selected.length >= 2 &&
        compareData.length === 0 && (
          <div className="text-center py-16 text-cream-20 text-sm font-body">
            No comparison data available
          </div>
        )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Suspense fallback                                                  */
/* ------------------------------------------------------------------ */

function CompareFallback() {
  return (
    <div className="text-center py-16">
      <div className="inline-flex items-center gap-3 bg-cream-5 border border-cream-8 rounded-xl px-6 py-4">
        <div className="w-4 h-4 border-2 border-cream-20 border-t-cream rounded-full animate-spin" />
        <span className="text-cream-40 text-sm font-body">
          Loading comparison...
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page export (wraps useSearchParams in Suspense)                    */
/* ------------------------------------------------------------------ */

export default function ComparePage() {
  return (
    <div className="relative z-[1] px-6 pt-8 pb-6">
      <AuroraBg />
      <FloatingParticles />
      <div className="max-w-[1340px] mx-auto">
        {/* Back nav */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-cream-40 text-sm font-body hover:text-cream-60 transition-colors mb-6 opacity-0 animate-fade-in-up"
          style={{ animationDelay: "0.04s" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Income Tracker
        </Link>

        {/* Header */}
        <header
          className="text-center mb-10 pb-7 border-b border-cream-8 opacity-0 animate-fade-in-up"
          style={{ animationDelay: "0.08s" }}
        >
          <div className="flex items-center justify-center gap-3 mb-2">
            <Users className="w-6 h-6 text-cream-40" />
            <h1 className="font-display text-[32px] font-normal text-cream tracking-[0.03em]">
              Validator Comparison
            </h1>
          </div>
          <p className="font-body text-cream-40 text-[15px] font-light">
            Compare up to {MAX_COMPARE} validators side by side — stake, APY,
            income & history
          </p>
        </header>

        {/* Main content wrapped in Suspense for useSearchParams */}
        <Suspense fallback={<CompareFallback />}>
          <CompareContent />
        </Suspense>

        <Footer />
      </div>
    </div>
  );
}
