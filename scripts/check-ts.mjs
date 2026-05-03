import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);
const earliest = await sql`SELECT epoch, created_at FROM epoch_snapshots WHERE validator_id = 200 ORDER BY epoch ASC LIMIT 5`;
const latest = await sql`SELECT epoch, created_at FROM epoch_snapshots WHERE validator_id = 200 ORDER BY epoch DESC LIMIT 5`;
console.log("--- EARLIEST PHASE SNAPSHOTS ---");
for (const r of earliest) console.log("  epoch", r.epoch, "createdAt", new Date(r.created_at).toISOString());
console.log("--- LATEST PHASE SNAPSHOTS ---");
for (const r of latest) console.log("  epoch", r.epoch, "createdAt", new Date(r.created_at).toISOString());

const npe = await sql`SELECT epoch, mon_price_usd, created_at FROM network_epochs WHERE epoch IN (1312, 1320, 1340, 1360, 1380, 1410, 1430, 1437) ORDER BY epoch ASC`;
console.log("--- NETWORK EPOCH PRICE SAMPLES ---");
for (const r of npe) console.log("  epoch", r.epoch, "price=$" + r.mon_price_usd, "createdAt", new Date(r.created_at).toISOString());
