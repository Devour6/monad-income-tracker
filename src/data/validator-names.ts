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
    const res = await fetch(
      "https://api.github.com/repos/monad-developers/validator-info/contents/mainnet",
      {
        headers: { Accept: "application/vnd.github.v3+json" },
        next: { revalidate: 3600 }, // Cache for 1 hour
      }
    );

    if (!res.ok) {
      console.warn(
        `[registry] GitHub API returned ${res.status}, using embedded registry`
      );
      return VALIDATOR_NAMES;
    }

    const files: Array<{ download_url: string }> = await res.json();
    const freshMap: Record<number, ValidatorInfo> = {};

    // Fetch each file in parallel with concurrency limit
    const CONCURRENCY = 20;
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const batch = files.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch
          .filter((f) => f.download_url?.endsWith(".json"))
          .map(async (f) => {
            const r = await fetch(f.download_url, {
              signal: AbortSignal.timeout(5000),
            });
            return r.json();
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
