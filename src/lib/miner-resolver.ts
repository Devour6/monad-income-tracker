/**
 * Miner address → validator_id resolver.
 *
 * Two cases:
 *   1. miner == validator authAddress (the simple case). Already seeded
 *      into miner_aliases when validators are inserted.
 *   2. miner is a distributor contract. The validator's authAddress
 *      lives in storage slot 0, packed into the lower 20 bytes.
 *
 * For (2) we read storage slot 0 via `eth_getStorageAt`, extract the
 * lower 20 bytes, and look up that address in the validators table.
 */

import { db } from "@/lib/db";
import { minerAliases, validators } from "@/lib/db/schema";
import { sql, eq } from "drizzle-orm";

const MONAD_RPC = process.env.MONAD_RPC_URL || "https://rpc.monad.xyz";

async function getStorageSlot(
  address: string,
  slot: string,
  blockTag: string = "latest"
): Promise<string | null> {
  const res = await fetch(MONAD_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getStorageAt",
      params: [address, slot, blockTag],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.result ?? null;
}

/**
 * Try to resolve a single miner address to a validator_id.
 * Returns the validator_id and source ('auth' | 'storage') on success,
 * or null when no mapping can be determined.
 */
export async function resolveMinerToValidator(
  minerAddress: string
): Promise<{ validatorId: number; source: "auth" | "storage" } | null> {
  const addr = minerAddress.toLowerCase();

  // Case 1: miner IS an authAddress already known.
  const direct = await db
    .select({ id: validators.validatorId })
    .from(validators)
    .where(sql`LOWER(${validators.authAddress}) = ${addr}`)
    .limit(1);
  if (direct.length > 0) {
    return { validatorId: direct[0].id, source: "auth" };
  }

  // Case 2: try storage slot 0. Pull the lower 20 bytes, look up.
  const slot0 = await getStorageSlot(addr, "0x0");
  if (!slot0 || slot0.length < 42) return null;

  const lower20 = "0x" + slot0.slice(-40);
  if (lower20 === "0x0000000000000000000000000000000000000000") return null;

  const indirect = await db
    .select({ id: validators.validatorId })
    .from(validators)
    .where(sql`LOWER(${validators.authAddress}) = ${lower20.toLowerCase()}`)
    .limit(1);
  if (indirect.length > 0) {
    return { validatorId: indirect[0].id, source: "storage" };
  }

  return null;
}

/**
 * Resolve all unmapped miner addresses currently in epoch_priority_fees,
 * persisting successful resolutions into miner_aliases. Returns counts.
 */
export async function resolveUnmappedMiners(): Promise<{
  unmapped: number;
  resolved: number;
  unresolved: string[];
}> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT epf.miner_address
    FROM epoch_priority_fees epf
    LEFT JOIN miner_aliases ma ON ma.miner_address = epf.miner_address
    WHERE ma.validator_id IS NULL
  `)) as unknown as
    | { rows: { miner_address: string }[] }
    | { miner_address: string }[];

  // neon-serverless returns array; pg returns { rows }
  const arr = Array.isArray(rows) ? rows : rows.rows;
  const list = arr.map((r) => r.miner_address);

  let resolved = 0;
  const unresolved: string[] = [];

  for (const addr of list) {
    try {
      const result = await resolveMinerToValidator(addr);
      if (result) {
        await db
          .insert(minerAliases)
          .values({
            minerAddress: addr,
            validatorId: result.validatorId,
            source: result.source,
          })
          .onConflictDoNothing();
        resolved++;
      } else {
        unresolved.push(addr);
      }
    } catch {
      unresolved.push(addr);
    }
    // gentle throttle
    await new Promise((r) => setTimeout(r, 50));
  }

  return { unmapped: list.length, resolved, unresolved };
}
