import { NextResponse } from "next/server";

/**
 * OpenAPI 3.1 spec for the public Monad Income Tracker API (v1).
 *
 * Served at /api/openapi.json. Consumed by the Swagger UI at /api/docs and
 * by client SDK generators (openapi-typescript, openapi-generator, etc.).
 */

export const revalidate = 3600;

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const baseUrl = `${incoming.protocol}//${incoming.host}`;

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Monad Income Tracker API",
      version: "1.0.0",
      description:
        "Public REST API for Monad validator income, MEV, network state, and analytics. " +
        "Free unauthenticated tier: 60 req/min per IP. " +
        "API-key tier: 600 req/min — request a key by emailing hello@phaselabs.io.",
      contact: {
        name: "Phase Labs",
        url: "https://github.com/Devour6/monad-income-tracker",
        email: "hello@phaselabs.io",
      },
      license: { name: "MIT" },
    },
    servers: [{ url: baseUrl, description: "Production" }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "Boosts limit from 60 to 600 req/min.",
        },
      },
      parameters: {
        ValidatorId: {
          name: "id",
          in: "path",
          required: true,
          description: "Validator ID (integer from staking precompile).",
          schema: { type: "integer", minimum: 1 },
          example: 1,
        },
        Epochs: {
          name: "epochs",
          in: "query",
          required: false,
          description: "Number of recent epochs to include (default 30, max 365).",
          schema: { type: "integer", minimum: 1, maximum: 365, default: 30 },
        },
        Lookback: {
          name: "lookback",
          in: "query",
          required: false,
          description: "Lookback window in days.",
          schema: { type: "integer", minimum: 1, maximum: 180, default: 7 },
        },
      },
    },
    security: [{}, { ApiKeyAuth: [] }],
    tags: [
      { name: "validators", description: "Per-validator data" },
      { name: "network", description: "Network-wide state and history" },
      { name: "leaderboard", description: "Ranked validator lists" },
      { name: "mev", description: "Priority-fee analytics" },
      { name: "indexer", description: "Indexer state and health" },
    ],
    paths: {
      "/api/v1/validators": {
        get: {
          tags: ["validators"],
          summary: "List validators",
          description: "Returns every tracked validator with current stake & commission.",
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/v1/validators/{id}": {
        get: {
          tags: ["validators"],
          summary: "Validator detail",
          parameters: [{ $ref: "#/components/parameters/ValidatorId" }],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/v1/validators/{id}/income": {
        get: {
          tags: ["validators"],
          summary: "Per-epoch income history",
          description:
            "Realized pool rewards, commission, self-stake share, priority fees, " +
            "production efficiency, and APY decomposition for the validator.",
          parameters: [
            { $ref: "#/components/parameters/ValidatorId" },
            { $ref: "#/components/parameters/Epochs" },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/v1/validators/{id}/report": {
        get: {
          tags: ["validators"],
          summary: "Income report (CSV/JSON)",
          description:
            "Accounting-grade income report. Supports `from`/`to` epoch range, " +
            "`fromDate`/`toDate` ISO range, `fx=per-epoch|end-of-period`, " +
            "`serverCostUsd`, `format=csv|json`.",
          parameters: [
            { $ref: "#/components/parameters/ValidatorId" },
            { name: "format", in: "query", schema: { type: "string", enum: ["csv", "json"], default: "json" } },
            { name: "from", in: "query", schema: { type: "integer" } },
            { name: "to", in: "query", schema: { type: "integer" } },
            { name: "fromDate", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "toDate", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "fx", in: "query", schema: { type: "string", enum: ["per-epoch", "end-of-period"], default: "per-epoch" } },
            { name: "serverCostUsd", in: "query", schema: { type: "number", minimum: 0 } },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/v1/validators/{id}/simulate": {
        get: {
          tags: ["validators"],
          summary: "Delegator income simulator",
          description:
            "Backtest a hypothetical delegation and project forward income with " +
            "p10/p90 variance bands.",
          parameters: [
            { $ref: "#/components/parameters/ValidatorId" },
            { name: "stakeMon", in: "query", schema: { type: "number", minimum: 0 } },
            { name: "horizonDays", in: "query", schema: { type: "integer", minimum: 1, maximum: 365 } },
            { $ref: "#/components/parameters/Lookback" },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/v1/network/overview": {
        get: {
          tags: ["network"],
          summary: "Network overview snapshot",
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/v1/network/history": {
        get: {
          tags: ["network"],
          summary: "Network state history",
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/v1/leaderboard": {
        get: {
          tags: ["leaderboard"],
          summary: "Validator leaderboard",
          parameters: [{ $ref: "#/components/parameters/Lookback" }],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/v1/compare": {
        get: {
          tags: ["validators"],
          summary: "Multi-validator comparison",
          parameters: [
            {
              name: "ids",
              in: "query",
              required: true,
              description: "Comma-separated validator IDs (max 10).",
              schema: { type: "string" },
              example: "1,2,3",
            },
            { $ref: "#/components/parameters/Epochs" },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/v1/mev": {
        get: {
          tags: ["mev"],
          summary: "Network priority-fee analytics",
          parameters: [{ $ref: "#/components/parameters/Lookback" }],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/v1/indexer/status": {
        get: {
          tags: ["indexer"],
          summary: "Indexer state & health",
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/v1/live-data": {
        get: {
          tags: ["network"],
          summary: "Live cluster snapshot (current epoch, top validators, MON price)",
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };

  const res = NextResponse.json(spec);
  res.headers.set("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}
