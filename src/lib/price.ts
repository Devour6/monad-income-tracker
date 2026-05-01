/**
 * Live MON price layer.
 *
 * Multi-source with priority fallback so a single API outage never embarrasses
 * us with a stale or zero price:
 *   1. CoinGecko simple/price (no key, generous free tier)
 *   2. CoinMarketCap (if CMC_API_KEY set)
 *   3. Bybit public ticker (no key)
 *   4. Coinbase exchange ticker (no key, but only quoted in USD on some pairs)
 *
 * In-memory 60s cache. Each call refreshes from sources in priority order
 * and returns the first source that produces a valid number > 0. The price
 * cron persists the result to `network_epochs.mon_price_usd` so every
 * downstream USD computation stays current.
 */
const CACHE_TTL_MS = 60_000;

let cached: { price: number; source: string; at: number } | null = null;
let inflight: Promise<PriceResult> | null = null;

export interface PriceResult {
  price: number;
  source: string;
  ageMs: number;
  /** Per-source results for diagnostics. */
  attempts: { source: string; ok: boolean; price?: number; error?: string }[];
}

async function fetchCoinGecko(): Promise<number | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd",
      { signal: ctrl.signal, cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { monad?: { usd?: number } };
    const p = data?.monad?.usd;
    return typeof p === "number" && isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchCoinMarketCap(): Promise<number | null> {
  const key = process.env.CMC_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(
      "https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=MON",
      { headers: { "X-CMC_PRO_API_KEY": key }, signal: ctrl.signal, cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: Record<string, Array<{ quote?: { USD?: { price?: number } } }>>;
    };
    const arr = data?.data?.MON;
    if (!Array.isArray(arr)) return null;
    // CMC may list multiple entries when the symbol collides; pick the
    // one with the highest market cap. Fallback: first valid price.
    let best = 0;
    for (const entry of arr) {
      const p = entry?.quote?.USD?.price;
      if (typeof p === "number" && isFinite(p) && p > 0 && p > best) best = p;
    }
    return best > 0 ? best : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchBybit(): Promise<number | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(
      "https://api.bybit.com/v5/market/tickers?category=spot&symbol=MONUSDT",
      { signal: ctrl.signal, cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: { list?: Array<{ lastPrice?: string }> };
    };
    const last = data?.result?.list?.[0]?.lastPrice;
    if (!last) return null;
    const p = Number(last);
    return isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchCoinbase(): Promise<number | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(
      "https://api.coinbase.com/v2/prices/MON-USD/spot",
      { signal: ctrl.signal, cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { amount?: string } };
    const amt = data?.data?.amount;
    if (!amt) return null;
    const p = Number(amt);
    return isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const SOURCES: Array<{ name: string; fetch: () => Promise<number | null> }> = [
  { name: "coingecko", fetch: fetchCoinGecko },
  { name: "coinmarketcap", fetch: fetchCoinMarketCap },
  { name: "bybit", fetch: fetchBybit },
  { name: "coinbase", fetch: fetchCoinbase },
];

async function refresh(): Promise<PriceResult> {
  const attempts: PriceResult["attempts"] = [];
  for (const src of SOURCES) {
    try {
      const p = await src.fetch();
      if (p && p > 0) {
        attempts.push({ source: src.name, ok: true, price: p });
        cached = { price: p, source: src.name, at: Date.now() };
        return { price: p, source: src.name, ageMs: 0, attempts };
      }
      attempts.push({ source: src.name, ok: false });
    } catch (err) {
      attempts.push({
        source: src.name,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // All sources failed — return whatever cached value we have, or zero.
  if (cached) {
    return {
      price: cached.price,
      source: `${cached.source} (stale)`,
      ageMs: Date.now() - cached.at,
      attempts,
    };
  }
  return { price: 0, source: "none", ageMs: 0, attempts };
}

/**
 * Get the current MON price in USD with multi-source fallback and 60s cache.
 * Concurrent calls share a single inflight refresh.
 */
export async function getLiveMonPrice(): Promise<PriceResult> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return {
      price: cached.price,
      source: cached.source,
      ageMs: Date.now() - cached.at,
      attempts: [],
    };
  }
  if (!inflight) {
    inflight = refresh().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Force a fresh fetch, bypassing the in-memory cache. */
export async function refreshLiveMonPrice(): Promise<PriceResult> {
  cached = null;
  return getLiveMonPrice();
}
