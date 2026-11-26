import {
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { Spec } from "../spec/gate.js";

export const specs = pgTable("specs", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only: rows are inserted, never updated.
export const revisions = pgTable(
  "revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    specId: uuid("spec_id")
      .notNull()
      .references(() => specs.id),
    version: integer("version").notNull(),
    prompt: text("prompt").notNull(),
    specJson: jsonb("spec_json").$type<Spec>().notNull(),
    restoredFrom: uuid("restored_from").references((): AnyPgColumn => revisions.id),
    idempotencyKey: text("idempotency_key"),
    attempts: integer("attempts").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("revisions_spec_id_version_unique").on(table.specId, table.version),
    unique("revisions_spec_id_idempotency_key_unique").on(table.specId, table.idempotencyKey),
  ],
);

// One row per UTC day, counting generate requests that reached the model.
// The daily cap reads and increments it in one statement, so it holds across Cloudflare locations.
export const dailyUsage = pgTable("daily_usage", {
  day: date("day").primaryKey(),
  generations: integer("generations").notNull(),
});
