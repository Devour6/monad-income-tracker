"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Code2, ExternalLink, Copy, Check } from "lucide-react";
import { AuroraBg } from "@/components/aurora-bg";
import { FloatingParticles } from "@/components/floating-particles";
import { Footer } from "@/components/footer";

type Lang = "curl" | "js" | "python";

interface Endpoint {
  method: "GET";
  path: string;
  title: string;
  desc: string;
  query?: string;
}

const ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/api/v1/validators",
    title: "List validators",
    desc: "All tracked validators with current stake, commission, and last epoch.",
  },
  {
    method: "GET",
    path: "/api/v1/validators/{id}",
    title: "Validator detail",
    desc: "Single validator with metadata.",
  },
  {
    method: "GET",
    path: "/api/v1/validators/{id}/income",
    title: "Per-epoch income",
    desc: "Pool rewards, commission, self-stake share, priority fees, APY decomposition.",
    query: "?epochs=30",
  },
  {
    method: "GET",
    path: "/api/v1/validators/{id}/report",
    title: "Income report (CSV/JSON)",
    desc: "Date-bounded report with FX methodology + server-cost input.",
    query: "?fromDate=2025-01-01&toDate=2025-04-01&fx=per-epoch&format=csv",
  },
  {
    method: "GET",
    path: "/api/v1/validators/{id}/simulate",
    title: "Delegator simulator",
    desc: "Backtest a delegation + projected income with p10/p90 bands.",
    query: "?stakeMon=10000&horizonDays=90&lookback=30",
  },
  {
    method: "GET",
    path: "/api/v1/leaderboard",
    title: "Leaderboard",
    desc: "Top validators by APY, efficiency, MEV, etc.",
    query: "?lookback=7",
  },
  {
    method: "GET",
    path: "/api/v1/network/overview",
    title: "Network overview",
    desc: "Current network state — total stake, active validators, MON price.",
  },
  {
    method: "GET",
    path: "/api/v1/network/history",
    title: "Network history",
    desc: "Per-epoch network state over time.",
  },
  {
    method: "GET",
    path: "/api/v1/mev",
    title: "MEV / priority fees",
    desc: "Network priority-fee analytics + validator leaderboard.",
    query: "?lookback=30",
  },
  {
    method: "GET",
    path: "/api/v1/compare",
    title: "Compare validators",
    desc: "Side-by-side metrics for up to 10 validators.",
    query: "?ids=1,2,3&epochs=30",
  },
  {
    method: "GET",
    path: "/api/v1/indexer/status",
    title: "Indexer status",
    desc: "Last block indexed, lag, health.",
  },
];

function fillPath(path: string): string {
  return path.replace("{id}", "1");
}

function snippet(lang: Lang, ep: Endpoint, base: string): string {
  const url = `${base}${fillPath(ep.path)}${ep.query ?? ""}`;
  switch (lang) {
    case "curl":
      return `curl -s "${url}" \\\n  -H "X-API-Key: \${API_KEY:-}"`;
    case "js":
      return `const res = await fetch("${url}", {
  headers: { "X-API-Key": process.env.MONAD_API_KEY ?? "" },
});
const data = await res.json();
console.log(data);`;
    case "python":
      return `import os, requests
r = requests.get(
    "${url}",
    headers={"X-API-Key": os.environ.get("MONAD_API_KEY", "")},
    timeout=15,
)
r.raise_for_status()
print(r.json())`;
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-1 rounded-md border border-cream-12 bg-cream-5 px-2 py-1 text-[11px] text-cream-60 hover:bg-cream-8"
    >
      {copied ? <Check className="h-3 w-3 text-phase-green" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function EndpointCard({ ep, base }: { ep: Endpoint; base: string }) {
  const [lang, setLang] = useState<Lang>("curl");
  const code = snippet(lang, ep, base);
  return (
    <div className="rounded-xl border border-cream-8 bg-cream-5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-phase-green/15 px-1.5 py-0.5 font-mono text-[10px] text-phase-green">
              {ep.method}
            </span>
            <code className="font-mono text-xs text-cream">
              {ep.path}
              {ep.query ?? ""}
            </code>
          </div>
          <h3 className="mt-2 font-display text-base text-cream tracking-wide">{ep.title}</h3>
          <p className="mt-1 text-xs font-body text-cream-60 leading-relaxed">{ep.desc}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        {(["curl", "js", "python"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            className={`rounded-md px-2 py-1 text-[11px] font-body transition-all ${
              lang === l
                ? "bg-phase-green/15 text-phase-green border border-phase-green/30"
                : "border border-cream-12 text-cream-60 hover:bg-cream-8"
            }`}
          >
            {l === "curl" ? "cURL" : l === "js" ? "JavaScript" : "Python"}
          </button>
        ))}
        <div className="ml-auto">
          <CopyButton text={code} />
        </div>
      </div>

      <pre className="mt-3 overflow-x-auto rounded-md border border-cream-8 bg-dark p-3 font-mono text-[11px] leading-relaxed text-cream-60">
        {code}
      </pre>
    </div>
  );
}

export default function SdkPage() {
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://monad-income-tracker.vercel.app";

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
              SDK & Examples
            </span>
          </div>
          <h1 className="font-display text-3xl text-cream tracking-wide">
            Public API — copy & paste
          </h1>
          <p className="mt-3 text-sm font-body text-cream-60 leading-relaxed">
            Versioned, stable endpoints under{" "}
            <code className="font-mono text-xs text-phase-green">/api/v1/*</code>.
            Free tier: 60 req/min per IP. With an{" "}
            <code className="font-mono text-xs text-phase-green">X-API-Key</code> header: 600 req/min.
            Email <a href="mailto:hello@phaselabs.io" className="text-phase-green hover:underline">hello@phaselabs.io</a> for a key.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/api-explorer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-phase-green/30 bg-phase-green/10 px-3 py-1.5 text-xs font-body text-phase-green hover:bg-phase-green/15"
            >
              Open API Explorer (Swagger) <ExternalLink className="h-3 w-3" />
            </Link>
            <a
              href="/api/openapi.json"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-cream-12 bg-cream-5 px-3 py-1.5 text-xs font-body text-cream-60 hover:bg-cream-8"
            >
              openapi.json <ExternalLink className="h-3 w-3" />
            </a>
            <Link
              href="/docs"
              className="inline-flex items-center gap-1.5 rounded-lg border border-cream-12 bg-cream-5 px-3 py-1.5 text-xs font-body text-cream-60 hover:bg-cream-8"
            >
              Full docs <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </header>

        <section className="space-y-4">
          {ENDPOINTS.map((ep) => (
            <EndpointCard key={ep.path} ep={ep} base={base} />
          ))}
        </section>

        <section className="mt-10 rounded-xl border border-cream-8 bg-cream-5 p-5 text-sm font-body text-cream-60">
          <h2 className="mb-2 font-display text-base text-cream tracking-wide">
            Versioning policy
          </h2>
          <p className="leading-relaxed">
            <code className="font-mono text-xs text-phase-green">/api/v1/*</code> response shapes are
            additive-only. New fields may be added; existing fields will not be renamed or removed
            without a v2 namespace. Internal routes under{" "}
            <code className="font-mono text-xs text-cream-40">/api/*</code> (un-versioned) may
            change without notice — pin to <code className="font-mono text-xs text-phase-green">v1</code> for production use.
          </p>
        </section>

        <Footer />
      </div>
    </div>
  );
}
