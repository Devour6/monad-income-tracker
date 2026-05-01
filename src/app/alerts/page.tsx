"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  Plus,
  Trash2,
  Copy,
  Check,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";

interface ValidatorListItem {
  validatorId: number;
  name: string;
  authAddress: string;
  stakeMon: number;
  commissionPct: number;
}

interface AlertRow {
  id: number;
  validatorId: number;
  kind: string;
  threshold: number;
  label: string | null;
  webhookUrl: string;
  active: boolean;
  fireCount: number;
  lastFiredAt: string | null;
  createdAt: string;
}

const KIND_OPTIONS: Array<{
  value: string;
  label: string;
  hint: string;
  unit: string;
  defaultThreshold: number;
}> = [
  {
    value: "commission_change",
    label: "Commission change",
    hint: "Fires when commission moves by ≥ N percentage points.",
    unit: "pp",
    defaultThreshold: 1,
  },
  {
    value: "missed_blocks",
    label: "Production efficiency drop",
    hint: "Fires when actual / expected blocks < N (0.5 = 50% on-pace).",
    unit: "ratio",
    defaultThreshold: 0.5,
  },
  {
    value: "apy_drop",
    label: "Pool APY drop",
    hint: "Fires when pool APY drops by ≥ N percentage points vs last seen.",
    unit: "pp",
    defaultThreshold: 2,
  },
  {
    value: "self_stake_change",
    label: "Self-stake change",
    hint: "Fires when self-stake moves by ≥ N MON.",
    unit: "MON",
    defaultThreshold: 50000,
  },
];

export default function AlertsPage() {
  const [validators, setValidators] = useState<ValidatorListItem[]>([]);
  const [validatorId, setValidatorId] = useState<number | null>(null);
  const [validatorQuery, setValidatorQuery] = useState("");
  const [kind, setKind] = useState(KIND_OPTIONS[0].value);
  const [threshold, setThreshold] = useState(
    KIND_OPTIONS[0].defaultThreshold,
  );
  const [webhookUrl, setWebhookUrl] = useState("");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<{
    id: number;
    secret: string;
  } | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [list, setList] = useState<AlertRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/validators")
      .then((r) => r.json())
      .then((d) => setValidators(d.validators || []))
      .catch(() => setValidators([]));
  }, []);

  useEffect(() => {
    if (validatorId == null) {
      setList([]);
      return;
    }
    fetch(`/api/alerts?validatorId=${validatorId}`)
      .then((r) => r.json())
      .then((d) => setList(d.alerts || []))
      .catch(() => setList([]));
  }, [validatorId, createdSecret]);

  const filtered = useMemo(() => {
    const q = validatorQuery.trim().toLowerCase();
    if (!q) return validators.slice(0, 50);
    return validators
      .filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.authAddress.toLowerCase().includes(q) ||
          String(v.validatorId).includes(q),
      )
      .slice(0, 50);
  }, [validators, validatorQuery]);

  const activeKind = KIND_OPTIONS.find((k) => k.value === kind)!;

  async function submit() {
    if (validatorId == null) {
      setErr("Pick a validator first");
      return;
    }
    if (!webhookUrl.startsWith("https://")) {
      setErr("Webhook URL must be https://");
      return;
    }
    setErr(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          validatorId,
          kind,
          threshold,
          webhookUrl,
          label: label || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "create failed");
      setCreatedSecret({ id: data.id, secret: data.ownerSecret });
      setWebhookUrl("");
      setLabel("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: number) {
    const secret = window.prompt(
      "Paste the ownerSecret you saved when creating this alert:",
    );
    if (!secret) return;
    const res = await fetch(`/api/alerts?id=${id}&secret=${secret}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setList((rows) => rows.filter((r) => r.id !== id));
    } else {
      const d = await res.json();
      alert(`Delete failed: ${d.error || res.status}`);
    }
  }

  function copySecret() {
    if (!createdSecret) return;
    navigator.clipboard.writeText(createdSecret.secret);
    setSecretCopied(true);
    setTimeout(() => setSecretCopied(false), 2000);
  }

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
            <Bell className="h-3.5 w-3.5 text-phase-yellow" />
            <span className="text-[10px] font-body uppercase tracking-widest text-cream-40">
              Validator alerts
            </span>
          </div>
          <h1 className="font-display text-3xl text-cream tracking-wide">
            Watchlist & webhooks
          </h1>
          <p className="mt-3 text-sm font-body text-cream-60 leading-relaxed">
            Get pinged when a validator changes commission, drops production,
            loses APY, or moves self-stake. Delivers to any Discord, Slack, or
            generic JSON webhook. Stateless — your only credential is the
            <code className="mx-1 font-mono text-xs text-phase-green">
              ownerSecret
            </code>
            we hand back on create. Save it.
          </p>
        </header>

        {/* ── Validator picker ──────────────────────────────────────── */}
        <section className="mb-8 rounded-xl border border-cream-8 bg-cream-5 p-5">
          <h2 className="mb-3 font-body text-sm uppercase tracking-widest text-cream-40">
            1 · Validator
          </h2>
          <input
            type="text"
            value={validatorQuery}
            onChange={(e) => setValidatorQuery(e.target.value)}
            placeholder="Search by name, address, or ID…"
            className="w-full rounded-lg border border-cream-8 bg-dark px-3 py-2 font-body text-sm text-cream placeholder:text-cream-40 focus:border-cream-20 focus:outline-none"
          />
          <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-cream-8 bg-dark/40">
            {filtered.length === 0 ? (
              <div className="p-3 text-xs font-body text-cream-40">
                No matches.
              </div>
            ) : (
              filtered.map((v) => (
                <button
                  key={v.validatorId}
                  type="button"
                  onClick={() => setValidatorId(v.validatorId)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-all hover:bg-cream-5 ${
                    validatorId === v.validatorId
                      ? "bg-phase-green/10 text-phase-green"
                      : "text-cream-60"
                  }`}
                >
                  <span className="truncate font-body">
                    #{v.validatorId} · {v.name}
                  </span>
                  <span className="font-mono text-[10px] text-cream-40">
                    {v.commissionPct.toFixed(2)}%
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        {/* ── Rule builder ───────────────────────────────────────── */}
        <section className="mb-8 rounded-xl border border-cream-8 bg-cream-5 p-5">
          <h2 className="mb-3 font-body text-sm uppercase tracking-widest text-cream-40">
            2 · Rule
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="font-body text-[11px] uppercase tracking-widest text-cream-40">
                Kind
              </span>
              <select
                value={kind}
                onChange={(e) => {
                  const k = KIND_OPTIONS.find((o) => o.value === e.target.value)!;
                  setKind(k.value);
                  setThreshold(k.defaultThreshold);
                }}
                className="rounded-lg border border-cream-8 bg-dark px-3 py-2 font-body text-sm text-cream focus:border-cream-20 focus:outline-none"
              >
                {KIND_OPTIONS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-body text-[11px] uppercase tracking-widest text-cream-40">
                Threshold ({activeKind.unit})
              </span>
              <input
                type="number"
                step="0.01"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="rounded-lg border border-cream-8 bg-dark px-3 py-2 font-mono text-sm text-cream focus:border-cream-20 focus:outline-none"
              />
            </label>
          </div>
          <p className="mt-2 text-[11px] font-body text-cream-40">
            {activeKind.hint}
          </p>
        </section>

        {/* ── Webhook + label ───────────────────────────────────── */}
        <section className="mb-8 rounded-xl border border-cream-8 bg-cream-5 p-5">
          <h2 className="mb-3 font-body text-sm uppercase tracking-widest text-cream-40">
            3 · Destination
          </h2>
          <label className="mb-3 flex flex-col gap-1">
            <span className="font-body text-[11px] uppercase tracking-widest text-cream-40">
              Webhook URL (Discord, Slack, or generic)
            </span>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
              className="rounded-lg border border-cream-8 bg-dark px-3 py-2 font-mono text-xs text-cream placeholder:text-cream-40 focus:border-cream-20 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-body text-[11px] uppercase tracking-widest text-cream-40">
              Label (optional)
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Magma Eden — commission watch"
              maxLength={200}
              className="rounded-lg border border-cream-8 bg-dark px-3 py-2 font-body text-sm text-cream placeholder:text-cream-40 focus:border-cream-20 focus:outline-none"
            />
          </label>
        </section>

        {err && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-phase-red/30 bg-red-dim px-4 py-3 text-xs font-body text-phase-red">
            <AlertTriangle className="h-3.5 w-3.5" />
            {err}
          </div>
        )}

        <button
          type="button"
          disabled={submitting || validatorId == null}
          onClick={submit}
          className="mb-10 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-phase-green/40 bg-phase-green/10 px-4 py-3 font-body text-sm font-medium text-phase-green transition-all hover:bg-phase-green/20 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          {submitting ? "Creating…" : "Create alert"}
        </button>

        {createdSecret && (
          <section className="mb-10 rounded-xl border border-phase-yellow/40 bg-yellow-dim p-5">
            <div className="mb-2 flex items-center gap-2 font-body text-xs uppercase tracking-widest text-phase-yellow">
              <AlertTriangle className="h-3.5 w-3.5" />
              Save this secret — you cannot recover it
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-cream-8 bg-dark px-3 py-2 font-mono text-xs text-cream">
              <span className="flex-1 truncate">{createdSecret.secret}</span>
              <button
                type="button"
                onClick={copySecret}
                className="inline-flex items-center gap-1 rounded border border-cream-8 px-2 py-1 text-[10px] uppercase tracking-widest text-cream-40 hover:text-cream-60"
              >
                {secretCopied ? (
                  <>
                    <Check className="h-3 w-3" /> copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> copy
                  </>
                )}
              </button>
            </div>
            <p className="mt-2 text-[11px] font-body text-cream-60">
              Required to delete or toggle alert #{createdSecret.id}.
            </p>
          </section>
        )}

        {/* ── Existing alerts for this validator ───────────── */}
        {validatorId != null && (
          <section className="mb-10">
            <h2 className="mb-3 font-display text-lg text-cream tracking-wide">
              Active rules for #{validatorId}
            </h2>
            {list.length === 0 ? (
              <div className="rounded-xl border border-cream-8 bg-cream-5 px-4 py-6 text-center text-xs font-body text-cream-40">
                No alerts yet.
              </div>
            ) : (
              <div className="space-y-2">
                {list.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between rounded-lg border border-cream-8 bg-cream-5 px-4 py-3"
                  >
                    <div>
                      <div className="font-body text-sm text-cream">
                        {a.label || a.kind}
                      </div>
                      <div className="font-mono text-[11px] text-cream-40">
                        {a.kind} · threshold {a.threshold} · fired{" "}
                        {a.fireCount}× · {a.webhookUrl}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(a.id)}
                      className="inline-flex items-center gap-1 rounded border border-cream-8 px-2 py-1 text-[11px] text-cream-40 transition-all hover:border-phase-red/40 hover:text-phase-red"
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="mb-10 rounded-xl border border-cream-8 bg-cream-5 p-5 text-xs font-body text-cream-60 leading-relaxed">
          <h3 className="mb-2 font-display text-base text-cream tracking-wide">
            How it works
          </h3>
          <ul className="ml-5 list-disc space-y-1.5">
            <li>
              The cron evaluator at{" "}
              <code className="font-mono text-[11px] text-phase-green">
                /api/cron/evaluate-alerts
              </code>{" "}
              runs on a schedule, recomputes each metric from on-chain data,
              and POSTs to your webhook when a rule trips.
            </li>
            <li>
              Discord & Slack incoming webhooks work out of the box — we send
              both <code className="font-mono text-[11px]">content</code> and{" "}
              <code className="font-mono text-[11px]">text</code> fields plus
              the full structured payload.
            </li>
            <li>
              No accounts, no email. The{" "}
              <code className="font-mono text-[11px]">ownerSecret</code> you
              receive at creation is the only credential — store it somewhere
              safe.
            </li>
            <li>
              Want to verify? See{" "}
              <Link
                href="/methodology"
                className="text-phase-green hover:underline"
              >
                /methodology
              </Link>{" "}
              for the formulas behind every metric these rules watch, or
              browse the source at{" "}
              <a
                href="https://github.com/Devour6/monad-income-tracker"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-phase-green hover:underline"
              >
                Devour6/monad-income-tracker
                <ExternalLink className="h-3 w-3" />
              </a>
              .
            </li>
          </ul>
        </section>
      </div>

      <Footer />
    </div>
  );
}
