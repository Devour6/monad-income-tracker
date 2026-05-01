import { db } from "@/lib/db";
import {
  validators,
  epochSnapshots,
  epochPriorityFees,
  minerAliases,
} from "@/lib/db/schema";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import Link from "next/link";

/**
 * Embeddable validator widget — server-rendered, no client JS.
 *
 * Usage from any external site:
 *   <iframe
 *     src="https://monad-income-tracker.vercel.app/embed/validator/123?theme=dark&compact=1"
 *     width="420" height="220" frameborder="0"
 *     style="border:0;background:transparent">
 *   </iframe>
 *
 * Frame-ancestors is permitted globally for /embed/* paths via middleware.
 *
 * Query params:
 *   theme=dark|light          (default dark)
 *   compact=1                 (single-row mini variant)
 *   metrics=apy,commission,…  (whitelist of metrics)
 */
export const revalidate = 300;

const ALL_METRICS = [
  "apy",
  "commission",
  "stake",
  "selfStake",
  "fees",
  "efficiency",
] as const;
type Metric = (typeof ALL_METRICS)[number];

const EPOCHS_PER_YEAR = 4.36 * 365;
const WEI = BigInt(10) ** BigInt(18);

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface WidgetData {
  validatorId: number;
  name: string;
  commissionPct: number;
  stakeMon: number;
  selfStakeMon: number | null;
  poolApy: number | null;
  delegatorApy: number | null;
  priorityFeesMon7d: number | null;
  efficiency: number | null;
}

interface Palette {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
}

const DARK: Palette = {
  bg: "#0F0E0C",
  fg: "#F3EED9",
  muted: "rgba(243,238,217,0.40)",
  border: "rgba(243,238,217,0.12)",
  accent: "#4ade80",
};

const LIGHT: Palette = {
  bg: "#FAF7EE",
  fg: "#1B1A17",
  muted: "rgba(27,26,23,0.55)",
  border: "rgba(27,26,23,0.12)",
  accent: "#16A34A",
};

export default async function EmbedValidator(props: Props) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const validatorId = parseInt(id, 10);
  if (!Number.isFinite(validatorId)) {
    return <ErrorPanel message="Invalid validator id" />;
  }

  const theme = (sp.theme as string) === "light" ? "light" : "dark";
  const compact = sp.compact === "1";
  const metricsParam = (sp.metrics as string) || "";
  const requested = metricsParam
    ? new Set(
        metricsParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean) as Metric[],
      )
    : new Set<Metric>(ALL_METRICS);

  let data: WidgetData | null = null;
  try {
    data = await loadValidator(validatorId);
  } catch (e) {
    return (
      <ErrorPanel
        message={`Load failed: ${e instanceof Error ? e.message : "unknown"}`}
      />
    );
  }
  if (data === null) {
    return <ErrorPanel message={`Validator #${validatorId} not found`} />;
  }
  const v: WidgetData = data;

  const p = theme === "light" ? LIGHT : DARK;

  return (
    <div
      style={{
        background: p.bg,
        color: p.fg,
        fontFamily:
          "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        padding: compact ? "10px 14px" : "14px 16px",
        border: `1px solid ${p.border}`,
        borderRadius: 12,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: compact ? 6 : 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: compact ? 13 : 15,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {v.name}
          </div>
          <div style={{ fontSize: 10, color: p.muted, marginTop: 2 }}>
            Monad validator · #{v.validatorId}
          </div>
        </div>
        <Link
          href={`/validators/${v.validatorId}`}
          target="_top"
          style={{
            fontSize: 10,
            color: p.accent,
            textDecoration: "none",
            whiteSpace: "nowrap",
            marginLeft: 12,
          }}
        >
          View →
        </Link>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: compact
            ? "repeat(3, minmax(0, 1fr))"
            : "repeat(2, minmax(0, 1fr))",
          gap: compact ? 6 : 10,
        }}
      >
        {requested.has("apy") && (
          <Stat
            palette={p}
            label="Pool APY"
            value={v.poolApy != null ? `${v.poolApy.toFixed(2)}%` : "—"}
            sub={
              v.delegatorApy != null
                ? `delegator ${v.delegatorApy.toFixed(2)}%`
                : undefined
            }
          />
        )}
        {requested.has("commission") && (
          <Stat
            palette={p}
            label="Commission"
            value={`${v.commissionPct.toFixed(2)}%`}
          />
        )}
        {requested.has("stake") && (
          <Stat
            palette={p}
            label="Total stake"
            value={fmtMon(v.stakeMon)}
          />
        )}
        {requested.has("selfStake") && v.selfStakeMon != null && (
          <Stat
            palette={p}
            label="Self-stake"
            value={fmtMon(v.selfStakeMon)}
          />
        )}
        {requested.has("fees") && v.priorityFeesMon7d != null && (
          <Stat
            palette={p}
            label="Priority fees · 7d"
            value={`${v.priorityFeesMon7d.toFixed(2)} MON`}
          />
        )}
        {requested.has("efficiency") && v.efficiency != null && (
          <Stat
            palette={p}
            label="Block efficiency"
            value={`${(v.efficiency * 100).toFixed(0)}%`}
          />
        )}
      </div>

      <div
        style={{
          marginTop: compact ? 8 : 12,
          fontSize: 9,
          color: p.muted,
          textAlign: "right",
        }}
      >
        <Link
          href="/"
          target="_top"
          style={{ color: p.muted, textDecoration: "none" }}
        >
          monad-income-tracker
        </Link>
      </div>
    </div>
  );
}

function Stat({
  palette,
  label,
  value,
  sub,
}: {
  palette: Palette;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          color: palette.muted,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: palette.muted, marginTop: 1 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: 16,
        background: "#0F0E0C",
        color: "#F87171",
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        borderRadius: 12,
        border: "1px solid rgba(248,113,113,0.3)",
      }}
    >
      {message}
    </div>
  );
}

function fmtMon(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M MON`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k MON`;
  return `${n.toFixed(0)} MON`;
}

async function loadValidator(
  validatorId: number,
): Promise<WidgetData | null> {
  const [val] = await db
    .select()
    .from(validators)
    .where(eq(validators.validatorId, validatorId))
    .limit(1);
  if (!val) return null;

  const snaps = await db
    .select()
    .from(epochSnapshots)
    .where(eq(epochSnapshots.validatorId, validatorId))
    .orderBy(desc(epochSnapshots.epoch))
    .limit(31);

  let poolApy: number | null = null;
  let delegatorApy: number | null = null;
  let efficiency: number | null = null;
  let priorityFeesMon7d: number | null = null;
  let selfStakeMon: number | null = null;

  if (snaps.length >= 2) {
    const newest = snaps[0];
    const oldest = snaps[snaps.length - 1];

    if (newest.selfStakeWei) {
      const sw = BigInt(newest.selfStakeWei);
      selfStakeMon = Number(sw / WEI) + Number(sw % WEI) / Number(WEI);
    }

    try {
      const accDelta =
        BigInt(newest.accRewardPerToken) -
        BigInt(oldest.accRewardPerToken);
      const stakeWei = BigInt(oldest.stakeWei);
      if (stakeWei > BigInt(0) && accDelta > BigInt(0)) {
        const RATIO = BigInt(10) ** BigInt(36);
        const yieldScaled = (accDelta * RATIO) / stakeWei;
        const totalYield = Number(yieldScaled) / Number(RATIO);
        const epochSpan = newest.epoch - oldest.epoch || 1;
        const perEpoch = totalYield / epochSpan;
        poolApy = perEpoch * EPOCHS_PER_YEAR * 100;
        const commRate = Number(BigInt(newest.commission)) / 1e18;
        delegatorApy = poolApy * (1 - commRate);
      }
    } catch {
      /* ignore */
    }

    try {
      const pfRows = (await db
        .select({
          feesWei: sql<string>`SUM(CAST(${epochPriorityFees.priorityFeesWei} AS NUMERIC))::TEXT`,
        })
        .from(epochPriorityFees)
        .innerJoin(
          minerAliases,
          eq(minerAliases.minerAddress, epochPriorityFees.minerAddress),
        )
        .where(
          and(
            eq(minerAliases.validatorId, validatorId),
            gte(epochPriorityFees.epoch, oldest.epoch),
          ),
        )) as unknown as { feesWei: string | null }[];
      const wei = BigInt(pfRows[0]?.feesWei ?? "0");
      priorityFeesMon7d =
        Number(wei / WEI) + Number(wei % WEI) / Number(WEI);
    } catch {
      /* skip */
    }

    try {
      const latestEpoch = newest.epoch;
      const valBlocks = (await db
        .select({
          blocks: sql<number>`SUM(${epochPriorityFees.blocksProposed})`,
        })
        .from(epochPriorityFees)
        .innerJoin(
          minerAliases,
          eq(minerAliases.minerAddress, epochPriorityFees.minerAddress),
        )
        .where(
          and(
            eq(minerAliases.validatorId, validatorId),
            eq(epochPriorityFees.epoch, latestEpoch),
          ),
        )) as unknown as { blocks: number | null }[];

      const totalBlocks = (await db
        .select({
          total: sql<number>`SUM(${epochPriorityFees.blocksProposed})`,
        })
        .from(epochPriorityFees)
        .where(eq(epochPriorityFees.epoch, latestEpoch))) as unknown as {
        total: number | null;
      }[];

      const totalStake = (await db
        .select({
          total: sql<string>`SUM(CAST(${epochSnapshots.stakeWei} AS NUMERIC))::TEXT`,
        })
        .from(epochSnapshots)
        .where(eq(epochSnapshots.epoch, latestEpoch))) as unknown as {
        total: string | null;
      }[];

      const myStake = BigInt(newest.stakeWei);
      const totalSt = BigInt(totalStake[0]?.total ?? "0");
      const total = Number(totalBlocks[0]?.total ?? 0);
      const actual = Number(valBlocks[0]?.blocks ?? 0);
      if (total > 0 && totalSt > BigInt(0)) {
        const RATIO = BigInt(10) ** BigInt(18);
        const shareScaled = (myStake * RATIO) / totalSt;
        const share = Number(shareScaled) / Number(RATIO);
        const expected = total * share;
        if (expected > 0) efficiency = actual / expected;
      }
    } catch {
      /* skip */
    }
  }

  return {
    validatorId,
    name: val.name || `Validator #${validatorId}`,
    commissionPct: Number(val.commissionPct) || 0,
    stakeMon: Number(val.stakeMon) || 0,
    selfStakeMon,
    poolApy,
    delegatorApy,
    priorityFeesMon7d,
    efficiency,
  };
}
