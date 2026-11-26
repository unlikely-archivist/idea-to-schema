import { createApp, DAILY_GENERATION_CAP } from "./app.js";
import { createDb } from "./db/client.js";
import { createWorkersAiGenerator } from "./generate/workers-ai-generator.js";

// The bindings and secrets set in wrangler.jsonc and with `wrangler secret put`.
interface Env {
  HYPERDRIVE: { connectionString: string };
  RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  WORKERS_AI_ACCOUNT_ID: string;
  WORKERS_AI_API_TOKEN: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

// Cloudflare entry point. Only /api/* reaches this code; the built page is served as static assets.
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // A new pool per request: Workers can't reuse a connection across requests.
    // The pool connects on its first query, so requests refused before touching the
    // database (rate limit, bad input, health check) never open a connection.
    // Hyperdrive keeps the real connections to Postgres warm, so connecting is fast.
    const db = createDb(env.HYPERDRIVE.connectionString);
    try {
      const app = createApp(
        db,
        createWorkersAiGenerator({ accountId: env.WORKERS_AI_ACCOUNT_ID, apiToken: env.WORKERS_AI_API_TOKEN }),
        {
          allowRequest: async (ip) => (await env.RATE_LIMITER.limit({ key: ip })).success,
          dailyCap: DAILY_GENERATION_CAP,
        },
      );
      return await app.fetch(request);
    } finally {
      ctx.waitUntil(db.$client.end());
    }
  },
};
