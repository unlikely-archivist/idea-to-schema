import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

// Runs once before all tests: creates the test database if missing and applies migrations.
export default async function setup() {
  if (existsSync(".env")) process.loadEnvFile(); // CI sets env vars directly
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("TEST_DATABASE_URL is not set");
  // Tests truncate every table, so refuse anything that isn't clearly a test database.
  const dbName = new URL(testUrl).pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`TEST_DATABASE_URL must name a *_test database, got "${dbName}"`);

  const admin = new Client({ connectionString: testUrl.replace(/\/[^/]+$/, "/postgres") });
  await admin.connect();
  const found = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (found.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const client = new Client({ connectionString: testUrl });
  await client.connect();
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();
}
