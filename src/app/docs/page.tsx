"use client";

import Link from "next/link";
import { ArrowLeft, Code, Clock, Zap, Copy, Check } from "lucide-react";
import { useState } from "react";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";

const BASE_URL = "https://monad-income-tracker.vercel.app";

interface Endpoint {
  method: "GET";
  path: string;
  summary: string;
  description: string;
  params?: Array<{ name: string; required: boolean; description: string; example?: string }>;
  example: string;
  response: string;
}

const endpoints: Endpoint[] = [
  {
    method: "GET",
    path: "/api/validators",
    summary: "List all tracked validators",
    description:
      "Returns every validator in the Monad execution set with current stake, commission, and last-seen epoch. Sorted by stake descending.",
    example: `${BASE_URL}/api/validators`,
    response: `{
  "validators": [
    {
      "validatorId": 97,
      "name": "Backpack",
      "authAddress": "0xbb8ee00846bf924f34ba4f8a86d690ff11eed7ca",
      "stakeMon": 1614710855,
      "commissionPct": 0,
      "lastEpoch": 1390
    },
    ...
  ],
  "count": 202
}`,
  },
  {
    method: "GET",
    path: "/api/validators/[id]",
    summary: "Detailed validator info",
    description:
      "Returns validator metadata, pool-level APY, realized income stats (commission, pool, delegator payouts), stake history, and commission history.",
    params: [
      {
        name: "epochs",
        required: false,
        description: "Number of snapshots of history to include (1–365, default 30)",
        example: "30",
      },
    ],
    example: `${BASE_URL}/api/validators/97?epochs=30`,
    response: `{
  "validator": {
    "validatorId": 97,
    "name": "Backpack",
    "authAddress": "0x...",
    "stakeMon": 1614710855,
    "commissionPct": 0,
    "lastEpoch": 1390,
    "updatedAt": "2026-04-21T00:50:48Z"
  },
  "apy": 12.87,
  "income": {
    "observed": {
      "epochCount": 21,
      "snapshotCount": 3,
      "daysObserved": 4.82,
      "poolRewardsMon": 230000,
      "commissionMon": 0,
      "delegatorRewardsMon": 230000
    },
    "rates": {
      "commissionPerDayMon": 0,
      "commissionPerMonthMon": 0,
      "commissionPerYearMon": 0,
      "poolPerDayMon": 47700,
      ...
    }
  },
  "stakeHistory": [...],
  "commissionHistory": [...],
  "latestEpoch": 1390
}`,
  },
  {
    method: "GET",
    path: "/api/validators/[id]/income",
    summary: "Per-snapshot realized income history",
    description:
      "Returns realized income computed from accumulator deltas between consecutive snapshots. This is the core SVT-style historical income feed — each row is actual earnings, not a projection.",
    params: [
      {
        name: "epochs",
        required: false,
        description: "Max snapshots to fetch (default 30, max 365)",
        example: "30",
      },
    ],
    example: `${BASE_URL}/api/validators/200/income?epochs=30`,
    response: `{
  "validatorId": 200,
  "epochs": [
    {
      "epoch": 1390,
      "epochSpan": 5,
      "poolRewardsMon": 15420,
      "commissionMon": 3084,
      "delegatorRewardsMon": 12336,
      "poolRewardsUsd": 501.99,
      "commissionUsd": 100.39,
      "stakeMon": 52600000,
      "commissionPct": 20,
      "monPriceUsd": 0.0325545,
      "timestamp": "2026-04-21T00:50:48Z"
    },
    ...
  ],
  "summary": {
    "observed": {
      "epochCount": 21,
      "snapshotCount": 4,
      "daysObserved": 4.82,
      "poolRewardsMon": 71300,
      "commissionMon": 14260,
      "delegatorRewardsMon": 57040,
      ...
    },
    "rates": {
      "commissionPerYearMon": 5673341,
      ...
    }
  }
}`,
  },
  {
    method: "GET",
    path: "/api/network/overview",
    summary: "Network-wide aggregate stats",
    description:
      "Total stake, active validator count, average commission, network-level pool APY, MON price, and the latest epoch observed.",
    example: `${BASE_URL}/api/network/overview`,
    response: `{
  "totalStakeMon": 14900000000,
  "totalStakeUsd": 485000000,
  "activeValidators": 202,
  "avgCommissionPct": 17.8,
  "networkApy": 11.4,
  "monPriceUsd": 0.0325,
  "latestEpoch": 1390,
  "epochSpan": 5,
  "updatedAt": "2026-04-21T00:50:48Z"
}`,
  },
  {
    method: "GET",
    path: "/api/network/history",
    summary: "Network history (per-epoch)",
    description:
      "One row per network epoch snapshot: total stake, active validator count, MON price at snapshot time.",
    params: [
      {
        name: "limit",
        required: false,
        description: "Max rows to return (1–365, default 90)",
        example: "90",
      },
    ],
    example: `${BASE_URL}/api/network/history?limit=30`,
    response: `{
  "history": [
    {
      "epoch": 1390,
      "totalStakeMon": 14900000000,
      "activeValidators": 202,
      "monPriceUsd": 0.0325,
      "createdAt": "2026-04-21T00:50:48Z"
    },
    ...
  ],
  "count": 30,
  "limit": 30
}`,
  },
  {
    method: "GET",
    path: "/api/compare",
    summary: "Compare multiple validators",
    description:
      "Side-by-side comparison: stake, commission, APY, realized income, stake history. Up to 5 validators per request.",
    params: [
      {
        name: "ids",
        required: true,
        description: "Comma-separated validator IDs (max 5)",
        example: "97,92,3,200,179",
      },
    ],
    example: `${BASE_URL}/api/compare?ids=97,92,3,200,179`,
    response: `{
  "validators": [
    {
      "validatorId": 97,
      "name": "Backpack",
      "stakeMon": 1614710855,
      "commissionPct": 0,
      "apy": 12.87,
      "totalIncomeMon": 230000,
      "epochsAnalyzed": 21,
      "stakeHistory": [...]
    },
    ...
  ],
  "count": 5
}`,
  },
  {
    method: "GET",
    path: "/api/live-data",
    summary: "Live network snapshot",
    description:
      "Current MON price, total network stake, and active validator count. Cached for 5 minutes. Lightweight — read from DB, no RPC calls.",
    example: `${BASE_URL}/api/live-data`,
    response: `{
  "monPrice": 0.0325,
  "networkStake": 14900000000,
  "activeValidators": 202,
  "updatedAt": "2026-04-21T00:50:48Z"
}`,
  },
];

function CodeBlock({ code, id }: { code: string; id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      <pre className="bg-dark border border-cream-8 rounded-lg p-4 text-xs font-mono text-cream-60 overflow-x-auto whitespace-pre">
        <code>{code}</code>
      </pre>
      <button
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute top-2 right-2 px-2 py-1 text-[10px] bg-cream-8 hover:bg-cream-12 text-cream-40 hover:text-cream rounded opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1"
        aria-label={`Copy ${id}`}
      >
        {copied ? (
          <>
            <Check className="w-3 h-3" /> Copied
          </>
        ) : (
          <>
            <Copy className="w-3 h-3" /> Copy
          </>
        )}
      </button>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="relative z-[1] px-6 pt-8 pb-6">
      <AuroraBg />
      <FloatingParticles />
      <div className="max-w-[900px] mx-auto">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-cream-40 text-xs font-body hover:text-phase-green transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Income Tracker
        </Link>

        {/* Header */}
        <header className="mb-10 pb-7 border-b border-cream-8">
          <h1 className="font-display text-[32px] font-normal mb-2 text-cream tracking-[0.03em]">
            API Documentation
          </h1>
          <p className="font-body text-cream-40 text-[15px] font-light">
            Public JSON API for Monad validator income, network stats, and
            historical staking data.
          </p>
        </header>

        {/* Intro */}
        <section className="mb-10">
          <h2 className="font-display text-lg text-cream tracking-wide mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-phase-green" />
            Quick Start
          </h2>
          <div className="bg-cream-5 border border-cream-8 rounded-xl p-5 space-y-3">
            <p className="text-cream-60 text-sm font-body leading-relaxed">
              All endpoints are GET, return JSON, and require no
              authentication. Base URL:
            </p>
            <CodeBlock code={BASE_URL} id="base-url" />
            <p className="text-cream-60 text-sm font-body leading-relaxed mt-4">
              Fetch the full validator list and one validator&apos;s realized income:
            </p>
            <CodeBlock
              id="quickstart"
              code={`curl ${BASE_URL}/api/validators
curl ${BASE_URL}/api/validators/200/income?epochs=30`}
            />
          </div>
        </section>

        {/* Data model */}
        <section className="mb-10">
          <h2 className="font-display text-lg text-cream tracking-wide mb-4">
            Data Model
          </h2>
          <div className="bg-cream-5 border border-cream-8 rounded-xl p-5">
            <ul className="text-cream-60 text-sm font-body space-y-3 leading-relaxed">
              <li>
                <strong className="text-cream">Snapshots:</strong> one per
                validator per cron run. Currently ~daily (midnight UTC). Each
                snapshot captures accumulator state from the Monad staking
                precompile.
              </li>
              <li>
                <strong className="text-cream">Realized income:</strong>
                computed as the delta of <code className="text-phase-green font-mono text-xs">accRewardPerToken</code>
                {" "}between consecutive snapshots × stake ÷ 10<sup>36</sup>. This
                is actual on-chain earnings, not a projection.
              </li>
              <li>
                <strong className="text-cream">Three income streams:</strong>
                <div className="mt-2 ml-4 space-y-1 text-xs">
                  <div>
                    <span className="text-phase-green font-mono">commissionMon</span>
                    {" "}— what the validator company earns (commission% × pool)
                  </div>
                  <div>
                    <span className="text-cream-60 font-mono">poolRewardsMon</span>
                    {" "}— total rewards the stake pool earned (self + delegators)
                  </div>
                  <div>
                    <span className="text-cream-60 font-mono">delegatorRewardsMon</span>
                    {" "}— what delegators collectively received
                  </div>
                </div>
              </li>
              <li>
                <strong className="text-cream">Rates vs realized:</strong>
                {" "}summary objects contain <code className="text-phase-green font-mono text-xs">observed</code>{" "}
                (realized earnings over the window) and <code className="text-phase-green font-mono text-xs">rates</code>{" "}
                (per-day/month/year rates extrapolated from observed averages).
                Rates are useful for comparison but should not be treated as
                guaranteed forward income.
              </li>
              <li>
                <strong className="text-cream">Caching:</strong> all endpoints
                set <code className="text-phase-green font-mono text-xs">Cache-Control: s-maxage=300, stale-while-revalidate=600</code>. Expect
                up to 5 minutes of staleness.
              </li>
            </ul>
          </div>
        </section>

        {/* Endpoints */}
        <section className="mb-10">
          <h2 className="font-display text-lg text-cream tracking-wide mb-4 flex items-center gap-2">
            <Code className="w-5 h-5 text-phase-green" />
            Endpoints
          </h2>
          <div className="space-y-6">
            {endpoints.map((e) => (
              <div
                key={e.path}
                className="bg-cream-5 border border-cream-8 rounded-xl p-5"
              >
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-phase-green/20 text-phase-green rounded">
                    {e.method}
                  </span>
                  <code className="text-cream font-mono text-sm">{e.path}</code>
                </div>
                <h3 className="text-cream text-base font-body font-medium mb-1">
                  {e.summary}
                </h3>
                <p className="text-cream-60 text-sm font-body leading-relaxed mb-4">
                  {e.description}
                </p>

                {e.params && e.params.length > 0 && (
                  <div className="mb-4">
                    <div className="text-cream-40 text-xs font-body uppercase tracking-wider mb-2">
                      Query Parameters
                    </div>
                    <div className="border border-cream-8 rounded-lg overflow-hidden">
                      <table className="w-full text-xs font-mono">
                        <thead>
                          <tr className="border-b border-cream-8 bg-cream-5">
                            <th className="px-3 py-2 text-left text-cream-40 font-normal">
                              Name
                            </th>
                            <th className="px-3 py-2 text-left text-cream-40 font-normal">
                              Required
                            </th>
                            <th className="px-3 py-2 text-left text-cream-40 font-normal">
                              Description
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {e.params.map((p) => (
                            <tr
                              key={p.name}
                              className="border-b border-cream-5 last:border-b-0"
                            >
                              <td className="px-3 py-2 text-phase-green">
                                {p.name}
                              </td>
                              <td className="px-3 py-2 text-cream-40">
                                {p.required ? "required" : "optional"}
                              </td>
                              <td className="px-3 py-2 text-cream-60 font-body">
                                {p.description}
                                {p.example && (
                                  <span className="text-cream-20 ml-2">
                                    e.g. {p.example}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="mb-4">
                  <div className="text-cream-40 text-xs font-body uppercase tracking-wider mb-2">
                    Example Request
                  </div>
                  <CodeBlock code={`curl ${e.example}`} id={`req-${e.path}`} />
                </div>

                <div>
                  <div className="text-cream-40 text-xs font-body uppercase tracking-wider mb-2">
                    Example Response
                  </div>
                  <CodeBlock code={e.response} id={`res-${e.path}`} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Rate limits & support */}
        <section className="mb-10">
          <h2 className="font-display text-lg text-cream tracking-wide mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-phase-green" />
            Rate Limits & Support
          </h2>
          <div className="bg-cream-5 border border-cream-8 rounded-xl p-5">
            <ul className="text-cream-60 text-sm font-body space-y-2 leading-relaxed">
              <li>
                <strong className="text-cream">Anonymous:</strong> 60 requests
                per minute per IP. Fine for light integration and one-off
                queries.
              </li>
              <li>
                <strong className="text-cream">With API key:</strong> 600
                requests per minute. Send your key as{" "}
                <code className="font-mono text-cream bg-cream-8 px-1.5 py-0.5 rounded text-xs">
                  X-API-Key: your-key
                </code>
                . Email{" "}
                <a
                  href="mailto:hello@phaselabs.io"
                  className="text-phase-green hover:underline"
                >
                  hello@phaselabs.io
                </a>{" "}
                for a key.
              </li>
              <li>
                <strong className="text-cream">Headers on every response:</strong>{" "}
                <code className="font-mono text-cream bg-cream-8 px-1.5 py-0.5 rounded text-xs">
                  X-RateLimit-Limit
                </code>
                ,{" "}
                <code className="font-mono text-cream bg-cream-8 px-1.5 py-0.5 rounded text-xs">
                  X-RateLimit-Remaining
                </code>
                ,{" "}
                <code className="font-mono text-cream bg-cream-8 px-1.5 py-0.5 rounded text-xs">
                  X-RateLimit-Reset
                </code>
                . 429 responses include{" "}
                <code className="font-mono text-cream bg-cream-8 px-1.5 py-0.5 rounded text-xs">
                  Retry-After
                </code>
                .
              </li>
              <li>
                <strong className="text-cream">Snapshot cadence:</strong> daily
                at 00:00 UTC. Historical data grows one row per validator per
                day.
              </li>
              <li>
                <strong className="text-cream">Built by:</strong>{" "}
                <a
                  href="https://phase.xyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-phase-green hover:underline"
                >
                  Phase
                </a>
                {" "}— validator infrastructure for Solana and Monad.
              </li>
              <li>
                <strong className="text-cream">Source:</strong>{" "}
                <a
                  href="https://github.com/Devour6/monad-income-tracker"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-phase-green hover:underline"
                >
                  GitHub
                </a>
              </li>
            </ul>
          </div>
        </section>

        <Footer />
      </div>
    </div>
  );
}
