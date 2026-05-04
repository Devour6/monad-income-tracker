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
 * to verify our numbers themselves against the on-chain data.
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
            This is an income tracker, not an income model. Every commission
            number on this site comes from on-chain events the validator
            actually signed. We don&apos;t multiply rates by stake to project
            income — we sum the literal MON that left the staking precompile
            and credit it as paid. Code is open at{" "}
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

        {/* ── Income, defined ────────────────────────────────────────── */}
        <section className="mt-10 mb-10">
          <h2 className="mb-4 font-display text-lg text-cream tracking-wide">
            What &ldquo;income&rdquo; means here
          </h2>
          <div className="space-y-4 rounded-xl border border-cream-8 bg-cream-5 p-5 text-sm font-body text-cream-60 leading-relaxed">
            <p>
              A Monad validator company collects income through two
              independent streams:
            </p>
            <ol className="ml-5 list-decimal space-y-3">
              <li>
                <strong className="text-cream">Commission</strong> — earned
                each block as a percentage of that block&apos;s reward,
                accumulated by the staking precompile in the validator&apos;s{" "}
                <code className="font-mono text-xs text-phase-green">unclaimedRewards</code>{" "}
                slot, and withdrawn whenever the validator&apos;s auth
                address calls{" "}
                <code className="font-mono text-xs text-phase-green">claimRewards(validatorId)</code>
                .
              </li>
              <li>
                <strong className="text-cream">Priority fees (MEV)</strong> —
                EIP-1559 priority fees flow directly to the block producer&apos;s
                native MON balance, bypassing the staking precompile entirely.
              </li>
            </ol>
            <p className="mt-2">
              Lifetime commission income =&nbsp;
              <code className="font-mono text-xs text-phase-green">
                Σ ClaimRewards.amount + currentUnclaimedRewards
              </code>
              . That&apos;s the exact MON that has been or can be paid into the
              validator&apos;s wallet, no projection involved.
            </p>
          </div>
        </section>

        {/* ── ClaimRewards event indexer ─────────────────────────────── */}
        <section className="mb-10">
          <h2 className="mb-4 font-display text-lg text-cream tracking-wide flex items-center gap-2">
            <Code2 className="h-5 w-5 text-phase-green" />
            ClaimRewards event indexer
          </h2>
          <div className="rounded-xl border border-cream-8 bg-cream-5 p-5 text-sm font-body text-cream-60 leading-relaxed space-y-3">
            <p>
              The staking precompile at{" "}
              <code className="font-mono text-xs text-phase-green">
                0x0000000000000000000000000000000000001000
              </code>{" "}
              emits a{" "}
              <code className="font-mono text-xs text-phase-green">
                ClaimRewards(uint64 validatorId, address delegator, uint256 amount, uint64 epoch)
              </code>{" "}
              event on every claim. Topic hash:
            </p>
            <pre className="rounded-md border border-cream-8 bg-dark p-3 text-xs font-mono text-cream overflow-x-auto">
{`0xcb607e6b63c89c95f6ae24ece9fe0e38a7971aa5ed956254f1df47490921727b`}
            </pre>
            <p>
              We continuously scan{" "}
              <code className="font-mono text-xs text-phase-green">eth_getLogs</code>{" "}
              against the precompile address filtered by that topic and
              persist every event into the{" "}
              <code className="font-mono text-xs text-phase-green">claim_events</code>{" "}
              table:
            </p>
            <pre className="rounded-md border border-cream-8 bg-dark p-3 text-xs font-mono text-cream overflow-x-auto">
{`validator_id  | uint64  -- the validator paid out from
delegator     | address -- the recipient of the claim
amount_wei    | uint256 -- exact MON paid (wei)
epoch         | uint64  -- on-chain epoch at claim time
block_number  | uint64  -- the block this claim landed in
block_timestamp        -- chain time of the claim
tx_hash       | text    -- the on-chain transaction`}
            </pre>
            <p>
              For{" "}
              <strong className="text-cream">validator commission</strong> we
              filter rows where{" "}
              <code className="font-mono text-xs text-phase-green">delegator</code>{" "}
              equals the validator&apos;s registered{" "}
              <code className="font-mono text-xs text-phase-green">authAddress</code>{" "}
              — that&apos;s the validator paying themselves their accumulated
              commission. Rows where the delegator is anyone else represent
              third-party delegators withdrawing their staking yield and are
              excluded from validator commission totals.
            </p>
          </div>
        </section>

        {/* ── Currently unclaimed ────────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="mb-4 font-display text-lg text-cream tracking-wide">
            Currently unclaimed balance
          </h2>
          <div className="rounded-xl border border-cream-8 bg-cream-5 p-5 text-sm font-body text-cream-60 leading-relaxed space-y-3">
            <p>
              The amount sitting in the precompile waiting to be claimed is
              read from{" "}
              <code className="font-mono text-xs text-phase-green">
                getValidator(validatorId)
              </code>{" "}
              slot 5 (<code className="font-mono text-xs text-phase-green">unclaimedRewards</code>).
              We snapshot it once per epoch and use the latest snapshot to
              report &ldquo;pending&rdquo; income.
            </p>
            <p>
              Lifetime commission =&nbsp;
              <code className="font-mono text-xs text-phase-green">
                claimed + currentUnclaimed
              </code>
              . The two together capture every MON of commission the
              validator has ever generated, whether already withdrawn or
              still claimable.
            </p>
          </div>
        </section>

        {/* ── FX methodology ─────────────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="mb-4 font-display text-lg text-cream tracking-wide">
            USD valuation: per-claim vs current price
          </h2>
          <div className="rounded-xl border border-cream-8 bg-cream-5 p-5 text-sm font-body text-cream-60 leading-relaxed space-y-3">
            <p>
              Every reporting endpoint accepts{" "}
              <code className="font-mono text-xs text-phase-green">?fx=per-epoch</code>{" "}
              or{" "}
              <code className="font-mono text-xs text-phase-green">?fx=end-of-period</code>:
            </p>
            <ul className="ml-5 list-disc space-y-2">
              <li>
                <strong className="text-cream">per-epoch (default)</strong> —
                each claim is valued at the MON/USD price recorded at that
                claim&apos;s epoch. Reflects what the income was worth at
                the time it was earned. Good for accounting and tax cost
                basis.
              </li>
              <li>
                <strong className="text-cream">end-of-period</strong> — every
                claim is valued at the current live MON/USD price. Reflects
                what the same MON is worth right now. Good for &ldquo;what
                is my treasury worth today.&rdquo;
              </li>
            </ul>
            <p>
              Historical prices come from CoinGecko&apos;s daily MON/USD,
              snapshotted into the{" "}
              <code className="font-mono text-xs text-phase-green">network_epochs</code>{" "}
              table per epoch. Live price is refreshed every two minutes via
              a CoinGecko poller.
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
              Priority fees on Monad don&apos;t flow through the staking
              precompile — they land directly in the block producer&apos;s
              MON balance. We index them at the block level:
            </p>
            <ol className="ml-5 list-decimal space-y-2">
              <li>
                Walk blocks forward using{" "}
                <code className="font-mono text-xs text-phase-green">eth_getBlockByNumber</code>{" "}
                + <code className="font-mono text-xs text-phase-green">eth_getBlockReceipts</code>.
              </li>
              <li>
                For each transaction (excluding the system tx at index 0)
                compute{" "}
                <code className="font-mono text-xs text-phase-green">
                  gasUsed × (effectiveGasPrice − baseFeePerGas)
                </code>
                .
              </li>
              <li>
                Sum per block, attribute to the block&apos;s{" "}
                <code className="font-mono text-xs text-phase-green">miner</code>{" "}
                address. Resolve miner → validator id via{" "}
                <code className="font-mono text-xs text-phase-green">miner_aliases</code>;
                for unknown miners we read the contract&apos;s storage slot 0
                (distributor contracts encode the validator&apos;s authAddress
                in the lower 20 bytes) and auto-create the alias.
              </li>
              <li>
                Aggregate per (epoch, miner) into{" "}
                <code className="font-mono text-xs text-phase-green">epoch_priority_fees</code>.
                Endpoints join through the alias table so a validator with
                multiple miner addresses sees the union.
              </li>
            </ol>
          </div>
        </section>

        {/* ── APY (delegator-facing) ─────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="mb-4 font-display text-lg text-cream tracking-wide">
            APY on the validator leaderboard
          </h2>
          <div className="rounded-xl border border-cream-8 bg-cream-5 p-5 text-sm font-body text-cream-60 leading-relaxed space-y-3">
            <p>
              The leaderboard at{" "}
              <Link href="/stake" className="text-phase-green hover:underline">
                /stake
              </Link>{" "}
              shows pool APY and delegator APY for shopping a validator.
              These are realized yields measured from the precompile&apos;s{" "}
              <code className="font-mono text-xs text-phase-green">accRewardPerToken</code>{" "}
              accumulator, not projections:
            </p>
            <pre className="rounded-md border border-cream-8 bg-dark p-3 text-xs font-mono text-cream overflow-x-auto">
{`reward_wei      = (acc_new − acc_old) × stake_wei / 10^36
yield_per_epoch = reward_wei / stake_wei / epoch_span
pool_apy        = yield_per_epoch × 4.36 × 365 × 100
delegator_apy   = pool_apy × (1 − commission_rate)`}
            </pre>
            <p>
              The accumulator is the on-chain ledger of every block reward
              the pool has ever earned. Annualizing the recent slope gives a
              measured yield, not a forecast.
            </p>
          </div>
        </section>

        {/* ── Simulator ──────────────────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="mb-4 font-display text-lg text-cream tracking-wide flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-phase-green" />
            What the delegator simulator does
          </h2>
          <div className="rounded-xl border border-cream-8 bg-cream-5 p-5 text-sm font-body text-cream-60 leading-relaxed space-y-3">
            <p>
              The page at{" "}
              <Link href="/simulate" className="text-phase-green hover:underline">
                /simulate
              </Link>{" "}
              <strong className="text-cream">is</strong> a projection — it
              estimates a delegator&apos;s future cumulative MON given the
              recent observed yield distribution. It&apos;s explicitly
              labeled as a forward simulator and uses percentile bands to
              show the spread of outcomes. It is not income tracking.
            </p>
            <p>
              All other pages (validator detail, leaderboards, reports) use
              real on-chain claim events for income reporting. Don&apos;t
              confuse the simulator&apos;s P50/P10/P90 numbers with realized
              earnings.
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
                Claim events are indexed from when the indexer started.
                Older claims that happened before that window aren&apos;t in
                the database, but are reflected in{" "}
                <code className="font-mono text-xs text-phase-green">currentUnclaimedRewards</code>{" "}
                if the validator hadn&apos;t claimed yet, or are absent
                otherwise. Forward indexing fills in real time.
              </li>
              <li>
                <strong className="text-cream">Indexer lag.</strong> A
                GitHub Actions cron pings the indexer every 5 minutes. New
                claim events show up within that window.
              </li>
              <li>
                <strong className="text-cream">USD valuation.</strong>{" "}
                MON/USD prices are from CoinGecko. Per-claim FX uses the
                daily price closest to the claim&apos;s block timestamp.
              </li>
              <li>
                <strong className="text-cream">Production efficiency.</strong>{" "}
                Monad&apos;s precompile doesn&apos;t expose per-validator
                vote credits or expected leader slots. We approximate it as{" "}
                <code className="font-mono text-xs text-phase-green">
                  actual_blocks / (network_blocks × stake_share)
                </code>{" "}
                from the block indexer&apos;s coverage. Above 1.0 =
                outperforming stake share.
              </li>
            </ul>
          </div>
        </section>

        <Footer />
      </div>
    </div>
  );
}
