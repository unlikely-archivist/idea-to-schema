import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDb } from "./db/client.js";
import { createWorkersAiGenerator } from "./generate/workers-ai-generator.js";

if (existsSync(".env")) process.loadEnvFile(); // hosts set env vars directly

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
const db = createDb(databaseUrl);

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !apiToken) throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set");
const generateSpec = createWorkersAiGenerator({ accountId, apiToken });

const app = createApp(db, generateSpec);

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});
