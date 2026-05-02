"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Wallet,
  Users,
  TrendingUp,
  Clock,
  Server,
  CheckCircle2,
  Hourglass,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";
import { ScrollReveal } from "@/components/scroll-reveal";

interface ValidatorMeta {
  validator: {
    validatorId: number;
    name: string;
    authAddress: string;
    stakeMon: number;
    commissionPct: number;
    lastEpoch: number | null;
  };
  apy: number;
  stakeHistory: Array<{ epoch: number; stakeMon: number; stakeWei: string }>;
}

interface RealizedIncome {
  validatorId: number;
  name: string;
  authAddress: string;
  firstEpoch: number;
  lastEpoch: number;
  epochSpan: number;
  daysObserved: number;
  snapshotCount: number;
  totalCommissionMon: number;
  totalCommissionUsd: number;
  currentUnclaimedMon: number;
  currentUnclaimedUsd: number;
  totalClaimedMon: number;
  totalClaimedUsd: number;
  claimEvents: Array<{ epoch: number; amountMon: number }>;
  monPriceUsd: number;
}

function formatMon(n: number): string {
  if (!isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function formatUsd(n: number): string {
  if (!n || !isFinite(n) || n === 0) return "";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function formatDays(days: number): string {
  if (!isFinite(days) || days <= 0) return "—";
  if (days < 1) return `${(days * 24).toFixed(1)} hours`;
  if (days < 30) return `${days.toFixed(1)} days`;
  if (days < 365) return `${(days / 30).toFixed(1)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

export default function ValidatorDetailPage() {
  const params = useParams();
  const validatorId = params?.id as string;

  const [meta, setMeta] = useState<ValidatorMeta | null>(null);
  const [realized, setRealized] = useState<RealizedIncome | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!validatorId) return;
    setLoading(true);
    setError(null);
    try {
      const [metaRes, realizedRes] = await Promise.all([
        fetch(`/api/v1/validators/${validatorId}`),
        fetch(`/api/v1/validators/${validatorId}/realized`),
      ]);

      if (!metaRes.ok) {
        const err = await metaRes.json();
        throw new Error(err.error || "Failed to load validator");
      }

      const [metaData, realizedData] = await Promise.all([
        metaRes.json() as Promise<ValidatorMeta>,
        realizedRes.json() as Promise<RealizedIncome>,
      ]);

      setMeta(metaData);
      setRealized(realizedData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [validatorId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Daily run rate from realized commission ÷ days observed.
  const perDayMon =
    realized && realized.daysObserved > 0
      ? realized.totalCommissionMon / realized.daysObserved
      : 0;
  const perMonthMon = perDayMon * 30;
  const perYearMon = perDayMon * 365;

  const monPrice = realized?.monPriceUsd ?? 0;

  return (
    <div className="relative z-[1] px-6 pt-8 pb-6">
      <AuroraBg />
      <FloatingParticles />
      <div className="max-w-[1200px] mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-cream-40 text-xs font-body hover:text-phase-green transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Income Tracker
        </Link>

        {/* Header */}
        {meta && (
          <header className="mb-8 pb-6 border-b border-cream-8">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <Server className="w-6 h-6 text-cream-40" />
              <h1 className="font-display text-[28px] font-normal text-cream tracking-[0.03em]">
                {meta.validator.name}
              </h1>
              <span className="text-cream-40 text-sm font-mono">
                #{meta.validator.validatorId}
              </span>
            </div>
            <div className="flex items-center gap-2 text-cream-40 text-xs font-mono">
              <span>{meta.validator.authAddress}</span>
              <a
                href={`https://monadexplorer.com/address/${meta.validator.authAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-phase-green transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </header>
        )}

        {loading && !meta && (
          <div className="text-center py-20 text-cream-40 text-sm font-body animate-pulse">
            Loading validator data...
          </div>
        )}

        {error && (
          <div className="text-center py-20">
            <div className="inline-flex flex-col items-center gap-4 bg-phase-red/10 border border-phase-red/30 rounded-2xl px-8 py-6">
              <div className="text-phase-red text-sm font-body">{error}</div>
            </div>
          </div>
        )}

        {meta && realized && (
          <>
            {/* HEADLINE — realized commission, exactly matches home page */}
            <ScrollReveal delay={0}>
              <div className="bg-gradient-to-br from-phase-green/10 via-phase-green/5 to-transparent border border-phase-green/30 rounded-2xl p-7 mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Wallet className="w-4 h-4 text-phase-green" />
                  <span className="text-phase-green text-[11px] font-body uppercase tracking-[0.12em]">
                    Lifetime Commission Earned
                  </span>
                </div>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-cream font-display text-5xl tracking-tight">
                    {formatMon(realized.totalCommissionMon)}
                  </span>
                  <span className="text-cream-40 text-xl font-body">MON</span>
                  {monPrice > 0 && (
                    <span className="text-phase-green/80 text-base font-body ml-2">
                      {formatUsd(realized.totalCommissionUsd)}
                    </span>
                  )}
                </div>
                <div className="text-cream-40 text-xs font-body mt-3">
                  Over {formatDays(realized.daysObserved)} · epochs{" "}
                  {realized.firstEpoch}–{realized.lastEpoch} ·{" "}
                  {realized.snapshotCount} snapshots
                </div>
              </div>
            </ScrollReveal>

            {/* Claimed vs Pending split */}
            <ScrollReveal delay={50}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="w-4 h-4 text-cream-40" />
                    <span className="text-cream-40 text-[11px] font-body uppercase tracking-[0.12em]">
                      Already Claimed
                    </span>
                  </div>
                  <div className="text-cream font-display text-3xl tracking-tight">
                    {formatMon(realized.totalClaimedMon)}
                    <span className="text-cream-40 text-base font-body ml-2">
                      MON
                    </span>
                  </div>
                  {monPrice > 0 && (
                    <div className="text-cream-40 text-xs mt-1">
                      {formatUsd(realized.totalClaimedUsd)}
                    </div>
                  )}
                  <div className="text-cream-40 text-xs font-body mt-2">
                    {realized.claimEvents.length} claim event
                    {realized.claimEvents.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Hourglass className="w-4 h-4 text-cream-40" />
                    <span className="text-cream-40 text-[11px] font-body uppercase tracking-[0.12em]">
                      Unclaimed (Pending)
                    </span>
                  </div>
                  <div className="text-cream font-display text-3xl tracking-tight">
                    {formatMon(realized.currentUnclaimedMon)}
                    <span className="text-cream-40 text-base font-body ml-2">
                      MON
                    </span>
                  </div>
                  {monPrice > 0 && (
                    <div className="text-cream-40 text-xs mt-1">
                      {formatUsd(realized.currentUnclaimedUsd)}
                    </div>
                  )}
                  <div className="text-cream-40 text-xs font-body mt-2">
                    Sitting in the staking contract
                  </div>
                </div>
              </div>
            </ScrollReveal>

            {/* Validator vitals */}
            <ScrollReveal delay={100}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-3.5 h-3.5 text-cream-40" />
                    <span className="text-cream-40 text-[10px] font-body uppercase tracking-wider">
                      Total Stake
                    </span>
                  </div>
                  <div className="text-cream text-xl font-body font-semibold">
                    {formatMon(meta.validator.stakeMon)}
                  </div>
                  <div className="text-cream-20 text-[11px] mt-1">MON</div>
                </div>
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Wallet className="w-3.5 h-3.5 text-cream-40" />
                    <span className="text-cream-40 text-[10px] font-body uppercase tracking-wider">
                      Commission
                    </span>
                  </div>
                  <div className="text-cream text-xl font-body font-semibold">
                    {meta.validator.commissionPct.toFixed(1)}%
                  </div>
                  <div className="text-cream-20 text-[11px] mt-1">
                    Validator keeps
                  </div>
                </div>
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-3.5 h-3.5 text-cream-40" />
                    <span className="text-cream-40 text-[10px] font-body uppercase tracking-wider">
                      Pool APY
                    </span>
                  </div>
                  <div className="text-cream text-xl font-body font-semibold">
                    {meta.apy.toFixed(2)}%
                  </div>
                  <div className="text-cream-20 text-[11px] mt-1">Gross</div>
                </div>
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-3.5 h-3.5 text-cream-40" />
                    <span className="text-cream-40 text-[10px] font-body uppercase tracking-wider">
                      Latest Epoch
                    </span>
                  </div>
                  <div className="text-cream text-xl font-body font-semibold">
                    {meta.validator.lastEpoch ?? "—"}
                  </div>
                  <div className="text-cream-20 text-[11px] mt-1">
                    Last snapshot
                  </div>
                </div>
              </div>
            </ScrollReveal>

            {/* Run rate */}
            <ScrollReveal delay={150}>
              <div className="mb-6">
                <h3 className="text-cream-40 text-[11px] font-body uppercase tracking-[0.12em] mb-3">
                  Commission Run Rate{" "}
                  <span className="text-cream-20 normal-case tracking-normal">
                    (extrapolated from observed average)
                  </span>
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Per Day", mon: perDayMon },
                    { label: "Per Month", mon: perMonthMon },
                    { label: "Per Year", mon: perYearMon },
                  ].map((r) => (
                    <div
                      key={r.label}
                      className="bg-cream-5 border border-cream-8 rounded-xl p-4"
                    >
                      <div className="text-cream-40 text-[10px] font-body uppercase tracking-wider mb-2">
                        {r.label}
                      </div>
                      <div className="text-cream text-lg font-body font-semibold">
                        {formatMon(r.mon)}
                        <span className="text-cream-40 text-xs ml-1">MON</span>
                      </div>
                      {monPrice > 0 && (
                        <div className="text-cream-20 text-[11px] mt-1">
                          {formatUsd(r.mon * monPrice)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </ScrollReveal>

            {/* Claim history table */}
            {realized.claimEvents.length > 0 && (
              <ScrollReveal delay={200}>
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-5 mb-6">
                  <h3 className="text-cream-40 text-[11px] font-body uppercase tracking-[0.12em] mb-4">
                    Claim History
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {[...realized.claimEvents]
                      .reverse()
                      .map((c) => (
                        <div
                          key={c.epoch}
                          className="flex items-center justify-between bg-cream-5 border border-cream-8 rounded-lg px-3 py-2"
                        >
                          <span className="text-cream-40 text-xs font-mono">
                            epoch {c.epoch}
                          </span>
                          <span className="text-cream text-sm font-body font-medium">
                            {formatMon(c.amountMon)}{" "}
                            <span className="text-cream-40 text-xs">MON</span>
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </ScrollReveal>
            )}

            {/* Stake history chart */}
            {meta.stakeHistory && meta.stakeHistory.length > 1 && (
              <ScrollReveal delay={250}>
                <div className="bg-cream-5 border border-cream-8 rounded-xl p-5">
                  <h3 className="text-cream-40 text-[11px] font-body uppercase tracking-[0.12em] mb-4">
                    Stake History
                  </h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={[...meta.stakeHistory].reverse()}>
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
                      <Tooltip
                        contentStyle={{
                          background: "#161513",
                          border: "1px solid rgba(243,238,217,0.12)",
                          borderRadius: "8px",
                          color: "#F3EED9",
                          fontSize: "12px",
                        }}
                        formatter={(value: number) => [
                          `${formatMon(value)} MON`,
                          "Stake",
                        ]}
                      />
                      <Line
                        type="monotone"
                        dataKey="stakeMon"
                        stroke="#80d0ff"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </ScrollReveal>
            )}
          </>
        )}

        <Footer />
      </div>
    </div>
  );
}
