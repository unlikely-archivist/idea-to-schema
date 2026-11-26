import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDb } from "./db/client.js";

if (existsSync(".env")) process.loadEnvFile(); // hosts set env vars directly

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
const db = createDb(databaseUrl);

// Placeholder until the real model adapter is built in step 6.
const generateSpec = async () => {
  throw new Error("Model adapter not built yet (step 6)");
};

const app = createApp(db, generateSpec);

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});
