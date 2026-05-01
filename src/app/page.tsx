"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Activity,
  GitCompareArrows,
  ExternalLink,
  BookOpen,
  Coins,
  Scale,
  TrendingUp,
  Zap,
  FileText,
} from "lucide-react";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";
import { ValidatorSearch } from "@/components/income/validator-search";
import { IncomeSummary } from "@/components/income/income-summary";
import { IncomeChart } from "@/components/income/income-chart";
import { IncomeTable } from "@/components/income/income-table";
import { ScrollReveal } from "@/components/scroll-reveal";

interface ValidatorListItem {
  validatorId: number;
  name: string;
  authAddress: string;
  stakeMon: number;
  commissionPct: number;
  lastEpoch: number;
}

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

interface IncomeSummaryData {
  observed: {
    epochCount: number;
    snapshotCount: number;
    daysObserved: number;
    poolRewardsMon: number;
    poolRewardsUsd: number;
    commissionMon: number;
    commissionUsd: number;
    delegatorRewardsMon: number;
    firstEpoch: number | null;
    lastEpoch: number | null;
  };
  rates: {
    commissionPerEpochMon: number;
    commissionPerDayMon: number;
    commissionPerMonthMon: number;
    commissionPerYearMon: number;
    poolPerEpochMon: number;
    poolPerDayMon: number;
    poolPerMonthMon: number;
    poolPerYearMon: number;
    commissionPerDayUsd: number;
    commissionPerMonthUsd: number;
    commissionPerYearUsd: number;
    poolPerDayUsd: number;
    poolPerMonthUsd: number;
    poolPerYearUsd: number;
  };
  latestMonPriceUsd: number;
}

export default function Home() {
  const [validators, setValidators] = useState<ValidatorListItem[]>([]);
  const [selectedValidator, setSelectedValidator] =
    useState<ValidatorListItem | null>(null);
  const [incomeData, setIncomeData] = useState<EpochIncome[]>([]);
  const [summary, setSummary] = useState<IncomeSummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [epochCount, setEpochCount] = useState(30);
  const [dbReady, setDbReady] = useState(true);

  // Fetch validator list
  useEffect(() => {
    fetch("/api/validators")
      .then((r) => r.json())
      .then((data) => {
        if (data.validators) {
          setValidators(data.validators);
        }
      })
      .catch(() => {
        setDbReady(false);
      });
  }, []);

  // Fetch income when validator or epoch count changes
  const fetchIncome = useCallback(
    async (validatorId: number, epochs: number) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/validators/${validatorId}/income?epochs=${epochs}`
        );
        const data = await res.json();
        setIncomeData(data.epochs || []);
        setSummary(data.summary || null);
      } catch {
        setIncomeData([]);
        setSummary(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (selectedValidator) {
      fetchIncome(selectedValidator.validatorId, epochCount);
    }
  }, [selectedValidator, epochCount, fetchIncome]);

  return (
    <div className="relative z-[1] px-6 pt-8 pb-6">
      <AuroraBg />
      <FloatingParticles />
      <div className="max-w-[1340px] mx-auto">
        {/* Header */}
        <header
          className="text-center mb-10 pb-7 border-b border-cream-8 opacity-0 animate-fade-in-up"
          style={{ animationDelay: "0.08s" }}
        >
          <h1 className="font-display text-[32px] font-normal mb-2 text-cream tracking-[0.03em]">
            Monad Income Tracker
          </h1>
          <p className="font-body text-cream-40 text-[15px] font-light">
            Historical validator income — block rewards & commission, epoch by
            epoch
          </p>
          {validators.length > 0 && (
            <div className="mt-3 inline-flex items-center gap-2 bg-cream-5 border border-cream-8 rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-phase-green animate-pulse" />
              <span className="text-cream-40 text-xs font-body">
                {validators.length} validators tracked
              </span>
            </div>
          )}
          <nav className="mt-4 flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/stake"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-body text-phase-green bg-phase-green/10 border border-phase-green/30 rounded-lg hover:bg-phase-green/15 transition-all"
            >
              <Coins className="w-3.5 h-3.5" />
              Choose a Validator
            </Link>
            <Link
              href="/network"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-body text-cream-40 bg-cream-5 border border-cream-8 rounded-lg hover:bg-cream-8 hover:text-cream-60 transition-all"
            >
              <Activity className="w-3.5 h-3.5" />
              Network Overview
            </Link>
            <Link
              href="/compare"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-body text-cream-40 bg-cream-5 border border-cream-8 rounded-lg hover:bg-cream-8 hover:text-cream-60 transition-all"
            >
              <GitCompareArrows className="w-3.5 h-3.5" />
              Compare Validators
            </Link>
            <Link
              href="/simulate"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-body text-cream-40 bg-cream-5 border border-cream-8 rounded-lg hover:bg-cream-8 hover:text-cream-60 transition-all"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Income Simulator
            </Link>
            <Link
              href="/reports"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-body text-cream-40 bg-cream-5 border border-cream-8 rounded-lg hover:bg-cream-8 hover:text-cream-60 transition-all"
            >
              <FileText className="w-3.5 h-3.5" />
              Reports
            </Link>
            <Link
              href="/mev"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-body text-cream-40 bg-cream-5 border border-cream-8 rounded-lg hover:bg-cream-8 hover:text-cream-60 transition-all"
            >
              <Zap className="w-3.5 h-3.5" />
              MEV Analytics
            </Link>
            <Link
              href="/methodology"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-body text-cream-40 bg-cream-5 border border-cream-8 rounded-lg hover:bg-cream-8 hover:text-cream-60 transition-all"
            >
              <Scale className="w-3.5 h-3.5" />
              Methodology
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-body text-cream-40 bg-cream-5 border border-cream-8 rounded-lg hover:bg-cream-8 hover:text-cream-60 transition-all"
            >
              <BookOpen className="w-3.5 h-3.5" />
              API Docs
            </Link>
          </nav>
        </header>

        {!dbReady ? (
          <div className="text-center py-20">
            <div className="inline-flex flex-col items-center gap-4 bg-cream-5 border border-cream-8 rounded-2xl px-8 py-6">
              <div className="text-cream-60 text-sm font-body">
                Database not connected. Set{" "}
                <code className="font-mono text-cream bg-cream-8 px-1.5 py-0.5 rounded">
                  DATABASE_URL
                </code>{" "}
                and run the snapshot cron to start collecting data.
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Validator Search — z-20 so dropdown renders above ScrollReveal siblings that create stacking contexts via transform */}
            <div className="relative z-20">
              <ScrollReveal delay={0}>
                <ValidatorSearch
                  validators={validators}
                  selected={selectedValidator}
                  onSelect={(v: ValidatorListItem) => setSelectedValidator(v)}
                />
              </ScrollReveal>
            </div>

            {selectedValidator && (
              <>
                {/* Validator actions */}
                <div className="flex items-center justify-between mt-6 mb-2">
                  <Link
                    href={`/validators/${selectedValidator.validatorId}`}
                    className="inline-flex items-center gap-1.5 text-cream-40 text-xs font-body hover:text-phase-green transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Full validator detail
                  </Link>
                  <div className="flex items-center gap-2">
                  <span className="text-cream-40 text-xs font-body">
                    Showing
                  </span>
                  {[30, 60, 90, 180].map((n) => (
                    <button
                      key={n}
                      onClick={() => setEpochCount(n)}
                      className={`px-3 py-1 text-xs rounded-full font-body transition-all ${
                        epochCount === n
                          ? "bg-cream text-dark font-medium"
                          : "bg-cream-5 text-cream-40 hover:bg-cream-8 hover:text-cream-60"
                      }`}
                    >
                      {n} epochs
                    </button>
                  ))}
                  </div>
                </div>

                {/* Income Summary Cards */}
                <ScrollReveal delay={100}>
                  <IncomeSummary
                    summary={summary}
                    validator={selectedValidator}
                    loading={loading}
                  />
                </ScrollReveal>

                {/* Income Chart */}
                <ScrollReveal delay={200}>
                  <IncomeChart data={incomeData} loading={loading} />
                </ScrollReveal>

                {/* Income Table */}
                <ScrollReveal delay={300}>
                  <IncomeTable data={incomeData} loading={loading} />
                </ScrollReveal>
              </>
            )}

            {!selectedValidator && validators.length > 0 && (
              <div className="text-center py-16 text-cream-20 text-sm font-body">
                Select a validator above to view their income history
              </div>
            )}
          </>
        )}

        <Footer />
      </div>
    </div>
  );
}
