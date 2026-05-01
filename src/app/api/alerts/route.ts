import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { alerts } from "@/lib/db/alerts";
import { eq, and, desc } from "drizzle-orm";
import crypto from "crypto";

const VALID_KINDS = new Set([
  "commission_change",
  "missed_blocks",
  "apy_drop",
  "self_stake_change",
]);

/**
 * GET /api/alerts?validatorId=N
 * Lists alerts for a validator. Returns owner_secret ONLY if the request
 * supplies the matching ?secret= for a specific id; the public list view
 * gets sanitized rows.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const validatorIdStr = url.searchParams.get("validatorId");
  const secret = url.searchParams.get("secret");

  if (!validatorIdStr) {
    return NextResponse.json(
      { error: "validatorId required" },
      { status: 400 }
    );
  }
  const validatorId = parseInt(validatorIdStr, 10);
  if (!Number.isFinite(validatorId)) {
    return NextResponse.json(
      { error: "validatorId must be an integer" },
      { status: 400 }
    );
  }

  try {
    const rows = await db
      .select()
      .from(alerts)
      .where(eq(alerts.validatorId, validatorId))
      .orderBy(desc(alerts.createdAt));

    return NextResponse.json({
      alerts: rows.map((r) => ({
        id: r.id,
        validatorId: r.validatorId,
        kind: r.kind,
        threshold: Number(r.threshold),
        label: r.label,
        // Mask webhook unless caller proves ownership of this rule.
        webhookUrl:
          secret && secret === r.ownerSecret
            ? r.webhookUrl
            : maskWebhook(r.webhookUrl),
        active: r.active,
        fireCount: r.fireCount,
        lastFiredAt: r.lastFiredAt,
        createdAt: r.createdAt,
      })),
      count: rows.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/alerts
 * Body: { validatorId, kind, threshold, webhookUrl, label? }
 * Returns { id, ownerSecret } — store the secret, it's required to delete.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const validatorId = Number(body.validatorId);
  const kind = String(body.kind || "");
  const threshold = Number(body.threshold);
  const webhookUrl = String(body.webhookUrl || "");
  const label = body.label ? String(body.label).slice(0, 200) : null;

  if (!Number.isFinite(validatorId) || validatorId < 0) {
    return NextResponse.json(
      { error: "validatorId must be a non-negative integer" },
      { status: 400 }
    );
  }
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${[...VALID_KINDS].join(", ")}` },
      { status: 400 }
    );
  }
  if (!Number.isFinite(threshold) || threshold < 0) {
    return NextResponse.json(
      { error: "threshold must be a non-negative number" },
      { status: 400 }
    );
  }
  // Webhook must be http(s). Block file://, data://, and local-network
  // private IPs to reduce SSRF surface.
  if (!isSafeWebhook(webhookUrl)) {
    return NextResponse.json(
      { error: "webhookUrl must be a public https:// URL" },
      { status: 400 }
    );
  }

  const ownerSecret = crypto.randomBytes(24).toString("hex");

  try {
    const [inserted] = await db
      .insert(alerts)
      .values({
        validatorId,
        kind,
        threshold: String(threshold),
        webhookUrl,
        label,
        ownerSecret,
      })
      .returning({ id: alerts.id });

    return NextResponse.json(
      {
        id: inserted.id,
        ownerSecret,
        message:
          "Save the ownerSecret — it's required to delete or toggle this alert. We do not store it elsewhere.",
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/alerts?id=N&secret=<ownerSecret>
 */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const idStr = url.searchParams.get("id");
  const secret = url.searchParams.get("secret");

  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  if (!secret) {
    return NextResponse.json({ error: "secret required" }, { status: 401 });
  }

  try {
    const result = await db
      .delete(alerts)
      .where(and(eq(alerts.id, id), eq(alerts.ownerSecret, secret)))
      .returning({ id: alerts.id });

    if (result.length === 0) {
      return NextResponse.json(
        { error: "not found or wrong secret" },
        { status: 404 }
      );
    }
    return NextResponse.json({ deleted: result[0].id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

function maskWebhook(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/…`;
  } catch {
    return "***";
  }
}

function isSafeWebhook(raw: string): boolean {
  if (!raw || raw.length > 2000) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  // Reject private/loopback/link-local hosts to limit SSRF blast radius.
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1"
  ) {
    return false;
  }
  // IPv4 private ranges
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
  if (/^127\./.test(host)) return false;
  if (/^169\.254\./.test(host)) return false; // link-local / metadata
  return true;
}
