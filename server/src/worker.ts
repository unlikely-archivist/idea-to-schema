import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { createApp, DAILY_GENERATION_CAP } from "./app.js";
import * as schema from "./db/schema.js";
import { createWorkersAiGenerator } from "./generate/workers-ai-generator.js";

// The bindings and secrets set in wrangler.jsonc and with `wrangler secret put`.
interface Env {
  HYPERDRIVE: { connectionString: string };
  RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

// Cloudflare entry point. Only /api/* reaches this code; the built page is served as static assets.
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // One client per request: Workers can't reuse a connection across requests.
    // Hyperdrive keeps the real connections to Postgres warm, so connecting is fast.
    const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
    await client.connect();
    try {
      const app = createApp(
        drizzle(client, { schema }),
        createWorkersAiGenerator({ accountId: env.CLOUDFLARE_ACCOUNT_ID, apiToken: env.CLOUDFLARE_API_TOKEN }),
        {
          allowRequest: async (ip) => (await env.RATE_LIMITER.limit({ key: ip })).success,
          dailyCap: DAILY_GENERATION_CAP,
        },
      );
      return await app.fetch(request);
    } finally {
      ctx.waitUntil(client.end());
    }
  },
};
