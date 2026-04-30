"use client";

import Link from "next/link";
import { ArrowLeft, BookOpen, GitBranch, Code2, AlertTriangle } from "lucide-react";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";
import { IndexerStatus } from "@/components/indexer-status";

/**
 * Public methodology page — explains every formula, every data source, and
 * every assumption. The point is auditability: any operator should be able
 * to verify our numbers themselves.
 */
export default function MethodologyPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-dark">
      <AuroraBg />
      <FloatingParticles />

      <div className="relative z-10 mx-auto max-w-3xl px-6 py-12">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-xs font-body text-cream-40 transition-all hover:text-cream-60"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>

        <header className="mb-10">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cream-8 bg-cream-5 px-3 py-1">
            <BookOpen className="h-3.5 w-3.5 text-phase-green" />
            <span className="text-[10px] font-body uppercase tracking-widest text-cream-40">
              Methodology
            </span>
          </div>
          <h1 className="font-display text-3xl text-cream tracking-wide">
            How every number is computed
          </h1>
          <p className="mt-3 text-sm font-body text-cream-60 leading-relaxed">
            Validator income data only matters if it&apos;s auditable. This
            page documents every formula, every data source, and every
            assumption used by the tracker — so any operator can verify what
            we say. If anything here looks wrong, the code is open at{" "}
            <a
              href="https://github.com/Devour6/monad-income-tracker"
              target="_blank"
              rel="noopener noreferrer"
              className="text-phase-green hover:underline"
            >
              Devour6/monad-income-tracker
            </a>
            .
          </p>
        </header>

        <IndexerStatus />

        {/* ── Income streams ─────────────────────────────────────────── */}
        <section className="mt-10 mb-10">
          <h2 className="mb-4 font-display text-lg text-cream tracking-wide">
            The four income streams
          </h2>
          <div className="space-y-4 rounded-xl border border-cream-8 bg-cream-5 p-5 text-sm font-body text-cream-60 leading-relaxed">
            <p>
              A Monad validator company&apos;s realized income decomposes
              into four observable streams:
            </p>
            <ol className="ml-5 list-decimal space-y-3">
              <li>
                <strong className="text-cream">Pool rewards</strong> — total
                inflation+commission rewards earned by the stake pool
                (validator self-stake + delegators). Sourced from the staking
                precompile&apos;s <code className="font-mono text-xs text-phase-green">accRewardPerToken</code>{" "}
                accumulator.
              </li>
              <li>
                <strong className="text-cream">Commission</strong> — what the
                validator company takes off the top.{" "}
                <code className="font-mono text-xs text-phase-green">commission_rate × pool_rewards</code>
                . The on-chain commission rate is an 18-decimal fixed-point.
              </li>
              <li>
                <strong className="text-cream">Self-stake share</strong> —
                validator&apos;s own delegation entry returns its proportional
                share of the post-commission delegator pool. Computed as{" "}
                <code className="font-mono text-xs text-phase-green">delegator_pool × (self_stake / total_stake)</code>
                .
              </li>
              <li>
                <strong className="text-cream">Priority fees (MEV)</strong> —
                EIP-1559 priority fees flow directly to the block producer,
                bypassing the staking precompile entirely. We index these at
                the block level (see below).
              </li>
            </ol>
            <p className="mt-2">
              Validator total realized income =&nbsp;
              <code className="font-mono text-xs text-phase-green">
                commission + self_stake_share + priority_fees
              </code>
              . Headline APY decomposition (pool / delegator / validator
              capital / commission yield) is derived from these per-epoch
              values.
            </p>
          </div>
        </section>

        {/* ── Pool rewards math ──────────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="mb-4 font-display text-lg text-cream tracking-wide">
            Pool reward calculation
          </h2>
          <div className="rounded-xl border border-cream-8 bg-cream-5 p-5 text-sm font-body text-cream-60 leading-relaxed space-y-3">
            <p>
              The Monad staking precompile at{" "}
              <code className="font-mono text-xs text-phase-green">0x1000</code>{" "}
              exposes <code className="font-mono text-xs text-phase-green">accRewardPerToken</code>
              {" "}— a monotonically increasing accumulator scaled by{" "}
              <code className="font-mono text-xs text-phase-green">10^36</code>.
              For any two snapshots on the same validator:
            </p>
            <pre className="rounded-md border border-cream-8 bg-dark p-3 text-xs font-mono text-cream overflow-x-auto">
{`reward_wei = (acc_new − acc_old) × stake_wei / 10^36
reward_mon = reward_wei / 10^18`}
            </pre>
            <p>
              We use the <em>previous</em> epoch&apos;s stake — that&apos;s
              the stake that earned this epoch&apos;s rewards — and never
              compute reward against the in-progress epoch.
            </p>
          </div>
        </section>

        {/* ── Priority fee indexer ───────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="mb-4 font-display text-lg text-cream tracking-wide flex items-center gap-2">
            <Code2 className="h-5 w-5 text-phase-green" />
            Priority fee indexer
          </h2>
          <div className="rounded-xl border border-cream-8 bg-cream-5 p-5 text-sm font-body text-cream-60 leading-relaxed space-y-3">
            <p>
              The interesting part. Priority fees on Monad don&apos;t go
              through the staking precompile — they land in the block
              producer&apos;s native MON balance. Earlier we proxied this
              via balance deltas, but balance is polluted by claims,
              transfers, and gas spends. So we replaced the proxy with a
              real block-level indexer:
            </p>
            <ol className="ml-5 list-decimal space-y-2">
              <li>
                Walk blocks forward from the persisted cursor using{" "}
                <code className="font-mono text-xs text-phase-green">eth_getBlockByNumber</code>{" "}
                + <code className="font-mono text-xs text-phase-green">eth_getBlockReceipts</code>.
              </li>
              <li>
                For each transaction (excluding the system tx at index 0)
                compute{" "}
                <code className="font-mono text-xs text-phase-green">
                  gasUsed × (effectiveGasPrice − baseFeePerGas)
                </code>
                . That&apos;s the priority fee paid to the block producer.
              </li>
              <li>
                Sum all priority fees in the block, attribute to the block&apos;s{" "}
                <code className="font-mono text-xs text-phase-green">miner</code>{" "}
                address.
              </li>
              <li>
                Resolve miner address → validator id via the{" "}
                <code className="font-mono text-xs text-phase-green">miner_aliases</code>{" "}
                table. Most validators produce blocks directly from their
                staking auth address, but some route block production
                through a distributor contract. For unknown miners, we
                read the contract&apos;s storage slot 0 — distributor
                contracts encode the validator&apos;s authAddress in the
                lower 20 bytes — and auto-create the alias.
              </li>
              <li>
                Aggregate per (epoch, miner) into{" "}
                <code className="font-mono text-xs text-phase-green">epoch_priority_fees</code>
                . Income API joins through{" "}
                <code className="font-mono text-xs text-phase-green">miner_aliases</code>{" "}
                so a validator with multiple miner addresses sees the union.
              </li>
            </ol>
            <p>
              Monad runs a flat 100 gwei base fee (verified across hundreds
              of blocks); we still read it from every block in case it
              changes.
            </p>
          </div>
        </section>

        {/* ── Production efficiency ──────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="mb-4 font-display text-lg text-cream tracking-wide">
            Block production efficiency
          </h2>
          <div className="rounded-xl border border-cream-8 bg-cream-5 p-5 text-sm font-body text-cream-60 leading-relaxed space-y-3">
            <p>
              Monad&apos;s staking precompile does <em>not</em> expose
              per-validator vote credits, skip rate, or expected leader
              slots. We verified this against the official precompile
              spec — only stake/reward state is queryable.
            </p>
            <p>
              As the closest available proxy, we compute{" "}
              <strong className="text-cream">stake-weighted production efficiency</strong>:
            </p>
            <pre className="rounded-md border border-cream-8 bg-dark p-3 text-xs font-mono text-cream overflow-x-auto">
{`expected_blocks = total_blocks_in_epoch × (stake / network_stake)
efficiency      = actual_blocks / expected_blocks`}
            </pre>
            <p>
              Above 1.0 = outperforming stake share; below = underperforming.
              Numbers are derived from the same indexed block data, so
              they&apos;re only as complete as the indexer&apos;s coverage
              of the epoch.
            </p>
          </div>
        </section>

        {/* ── Realized vs projected ──────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="mb-4 font-display text-lg text-cream tracking-wide flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-phase-green" />
            Realized vs projected
          </h2>
          <div className="rounded-xl border border-cream-8 bg-cream-5 p-5 text-sm font-body text-cream-60 leading-relaxed space-y-3">
            <p>
              We never report unrealized epochs as income. Snapshots are
              taken only outside the staking precompile&apos;s delay period,
              and every income figure is computed against a completed
              epoch boundary.
            </p>
            <p>
              Run-rate fields (per-day / per-month / per-year) are{" "}
              <strong className="text-cream">extrapolations</strong> from
              the observed average — useful for comparison but not a
              guarantee. SVT.one&apos;s discipline of separating realized
              earnings from projections is the model we follow.
            </p>
          </div>
        </section>

        {/* ── Caveats ────────────────────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="mb-4 font-display text-lg text-cream tracking-wide flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-phase-green" />
            Known caveats
          </h2>
          <div className="rounded-xl border border-cream-8 bg-cream-5 p-5 text-sm font-body text-cream-60 leading-relaxed space-y-3">
            <ul className="ml-5 list-disc space-y-2">
              <li>
                <strong className="text-cream">History depth.</strong>{" "}
                Tracker started indexing recently — historical priority fee
                coverage only extends as far back as the indexer has
                walked.
              </li>
              <li>
                <strong className="text-cream">Miner coverage.</strong>{" "}
                Some block producer addresses are EOAs not in the staking
                precompile&apos;s active set. Their blocks are still
                indexed — their fees just aren&apos;t attributed to a
                validator id until manually mapped.
              </li>
              <li>
                <strong className="text-cream">Indexer lag.</strong> The
                live cursor lags the chain head by however long it takes
                the GitHub Actions scheduler to fire. Status badge above
                shows current lag.
              </li>
              <li>
                <strong className="text-cream">USD valuation.</strong>{" "}
                MON/USD price is captured per epoch from a single oracle
                source. Historical USD figures use the price snapshot
                contemporaneous with that epoch.
              </li>
            </ul>
          </div>
        </section>

        <Footer />
      </div>
    </div>
  );
}
