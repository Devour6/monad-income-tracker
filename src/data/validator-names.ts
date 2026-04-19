/**
 * Validator ID → name + metadata mapping.
 *
 * Primary source: monad-developers/validator-info GitHub repo (official registry).
 * The registry JSON is embedded at build time and refreshed from GitHub at runtime.
 */
import registryData from "./validator-registry.json";

export interface ValidatorInfo {
  name: string;
  logo?: string;
  website?: string;
  x?: string;
  description?: string;
}

interface RegistryEntry {
  name: string;
  logo?: string;
  website?: string;
  x?: string;
  description?: string;
}

// Build the VALIDATOR_NAMES map from the embedded registry JSON
const registry = registryData as Record<string, RegistryEntry>;

export const VALIDATOR_NAMES: Record<number, ValidatorInfo> = {};
for (const [id, entry] of Object.entries(registry)) {
  VALIDATOR_NAMES[Number(id)] = {
    name: entry.name,
    logo: entry.logo,
    website: entry.website,
    x: entry.x,
    description: entry.description,
  };
}

/**
 * Fetch the latest validator registry from GitHub.
 * Returns a map of validator ID → name.
 * Falls back to the embedded registry on failure.
 */
export async function fetchFreshRegistry(): Promise<
  Record<number, ValidatorInfo>
> {
  try {
    // Use GitHub Trees API — single request gets all file metadata
    const treeRes = await fetch(
      "https://api.github.com/repos/monad-developers/validator-info/git/trees/main?recursive=1",
      {
        headers: { Accept: "application/vnd.github.v3+json" },
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!treeRes.ok) {
      console.warn(
        `[registry] GitHub Trees API returned ${treeRes.status}, using embedded registry`
      );
      return VALIDATOR_NAMES;
    }

    const tree = await treeRes.json();
    const jsonFiles = (tree.tree as Array<{ path: string; url: string }>).filter(
      (f) => f.path.startsWith("mainnet/") && f.path.endsWith(".json")
    );

    const freshMap: Record<number, ValidatorInfo> = {};

    // Fetch blobs in batches of 10 with delays to respect rate limits
    const CONCURRENCY = 10;
    for (let i = 0; i < jsonFiles.length; i += CONCURRENCY) {
      const batch = jsonFiles.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (f) => {
          const r = await fetch(f.url, {
            headers: { Accept: "application/vnd.github.v3+json" },
            signal: AbortSignal.timeout(5000),
          });
          const blob = await r.json();
          // GitHub blob API returns base64-encoded content
          const content = JSON.parse(
            Buffer.from(blob.content, "base64").toString("utf-8")
          );
          return content;
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled" && r.value?.id != null) {
          const v = r.value;
          freshMap[v.id] = {
            name: v.name || `Validator #${v.id}`,
            logo: v.logo,
            website: v.website,
            x: v.x,
            description: v.description,
          };
        }
      }

      // Pause between batches to respect GitHub rate limits
      if (i + CONCURRENCY < jsonFiles.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    if (Object.keys(freshMap).length > 100) {
      console.log(
        `[registry] Fetched ${Object.keys(freshMap).length} validators from GitHub`
      );
      return freshMap;
    }

    console.warn(
      `[registry] Only got ${Object.keys(freshMap).length} validators, using embedded`
    );
    return VALIDATOR_NAMES;
  } catch (error) {
    console.warn("[registry] Failed to fetch from GitHub:", error);
    return VALIDATOR_NAMES;
  }
}
