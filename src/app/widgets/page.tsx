"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Code2, Copy, Check, ExternalLink } from "lucide-react";
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

const ALL_METRICS = [
  { key: "apy", label: "Pool / delegator APY" },
  { key: "commission", label: "Commission %" },
  { key: "stake", label: "Total stake" },
  { key: "selfStake", label: "Self-stake" },
  { key: "fees", label: "Priority fees · 7d" },
  { key: "efficiency", label: "Block efficiency" },
] as const;

export default function WidgetsPage() {
  const [validators, setValidators] = useState<ValidatorListItem[]>([]);
  const [validatorId, setValidatorId] = useState<number | null>(null);
  const [validatorQuery, setValidatorQuery] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [compact, setCompact] = useState(false);
  const [enabled, setEnabled] = useState<Set<string>>(
    new Set(ALL_METRICS.map((m) => m.key)),
  );
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/validators")
      .then((r) => r.json())
      .then((d) => setValidators(d.validators || []))
      .catch(() => setValidators([]));
  }, []);

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

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (theme === "light") p.set("theme", "light");
    if (compact) p.set("compact", "1");
    if (enabled.size !== ALL_METRICS.length) {
      p.set("metrics", [...enabled].join(","));
    }
    return p.toString();
  }, [theme, compact, enabled]);

  const embedSrc = useMemo(() => {
    if (validatorId == null) return "";
    const base = `${origin}/embed/validator/${validatorId}`;
    return params ? `${base}?${params}` : base;
  }, [origin, validatorId, params]);

  const embedCode = useMemo(() => {
    if (!embedSrc) return "";
    const w = compact ? 520 : 420;
    const h = compact ? 100 : 220;
    return `<iframe
  src="${embedSrc}"
  width="${w}" height="${h}" frameborder="0"
  style="border:0;background:transparent;border-radius:12px"
  loading="lazy"
  title="Monad validator stats"
></iframe>`;
  }, [embedSrc, compact]);

  function toggleMetric(key: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function copy() {
    if (!embedCode) return;
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
            <Code2 className="h-3.5 w-3.5 text-phase-green" />
            <span className="text-[10px] font-body uppercase tracking-widest text-cream-40">
              Embeddable widgets
            </span>
          </div>
          <h1 className="font-display text-3xl text-cream tracking-wide">
            Drop validator stats into any site
          </h1>
          <p className="mt-3 text-sm font-body text-cream-60 leading-relaxed">
            Server-rendered iframes — no JS, no tracking, no API keys. Pick a
            validator, choose what to show, paste the snippet. Updates every 5
            minutes from the same indexer that powers the rest of this site.
          </p>
        </header>

        {/* ── Validator picker ───────────────────────────────── */}
        <section className="mb-6 rounded-xl border border-cream-8 bg-cream-5 p-5">
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

        {/* ── Options ──────────────────────────────────── */}
        <section className="mb-6 rounded-xl border border-cream-8 bg-cream-5 p-5">
          <h2 className="mb-3 font-body text-sm uppercase tracking-widest text-cream-40">
            2 · Options
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-body text-[11px] uppercase tracking-widest text-cream-40">
                Theme
              </span>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as "dark" | "light")}
                className="rounded-lg border border-cream-8 bg-dark px-3 py-2 font-body text-sm text-cream focus:border-cream-20 focus:outline-none"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
            <label className="flex items-end gap-2">
              <input
                type="checkbox"
                checked={compact}
                onChange={(e) => setCompact(e.target.checked)}
                className="h-4 w-4 accent-phase-green"
              />
              <span className="font-body text-sm text-cream-60">
                Compact (single-row mini)
              </span>
            </label>
          </div>
          <div className="mt-4">
            <span className="mb-2 block font-body text-[11px] uppercase tracking-widest text-cream-40">
              Metrics shown
            </span>
            <div className="flex flex-wrap gap-2">
              {ALL_METRICS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => toggleMetric(m.key)}
                  className={`rounded-lg border px-3 py-1 font-body text-xs transition-all ${
                    enabled.has(m.key)
                      ? "border-phase-green/40 bg-phase-green/10 text-phase-green"
                      : "border-cream-8 bg-dark text-cream-40 hover:text-cream-60"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── Preview ─────────────────────────────────── */}
        {validatorId != null && embedSrc && (
          <section className="mb-6 rounded-xl border border-cream-8 bg-cream-5 p-5">
            <h2 className="mb-3 font-body text-sm uppercase tracking-widest text-cream-40">
              3 · Preview
            </h2>
            <div className="rounded-lg border border-cream-8 bg-dark p-3">
              <iframe
                src={embedSrc}
                width={compact ? 520 : 420}
                height={compact ? 100 : 220}
                style={{
                  border: 0,
                  background: "transparent",
                  borderRadius: 12,
                  maxWidth: "100%",
                }}
                title="Embed preview"
                key={embedSrc}
              />
            </div>
          </section>
        )}

        {/* ── Snippet ─────────────────────────────────── */}
        {validatorId != null && embedCode && (
          <section className="mb-10 rounded-xl border border-cream-8 bg-cream-5 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-body text-sm uppercase tracking-widest text-cream-40">
                4 · Copy snippet
              </h2>
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1 rounded border border-cream-8 px-2 py-1 text-[10px] uppercase tracking-widest text-cream-40 hover:text-cream-60"
              >
                {copied ? (
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
            <pre className="overflow-x-auto rounded-lg border border-cream-8 bg-dark p-3 font-mono text-[11px] text-cream-60 leading-relaxed">
              {embedCode}
            </pre>
          </section>
        )}

        <section className="mb-10 rounded-xl border border-cream-8 bg-cream-5 p-5 text-xs font-body text-cream-60 leading-relaxed">
          <h3 className="mb-2 font-display text-base text-cream tracking-wide">
            Why use these
          </h3>
          <ul className="ml-5 list-disc space-y-1.5">
            <li>
              <strong className="text-cream">Server-rendered.</strong> No
              client JS — instant first paint, no flash, no layout shift.
            </li>
            <li>
              <strong className="text-cream">Private by default.</strong> The
              widget loads once per visitor and caches at the edge for 5
              minutes. We see iframe loads, nothing else.
            </li>
            <li>
              <strong className="text-cream">Theme-matched.</strong> Light or
              dark to fit your site, transparent background to drop into any
              container.
            </li>
            <li>
              <strong className="text-cream">Metric-controllable.</strong>{" "}
              Show only the data you want — APY, commission, fees, efficiency,
              self-stake, total stake.
            </li>
            <li>
              Source at{" "}
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
