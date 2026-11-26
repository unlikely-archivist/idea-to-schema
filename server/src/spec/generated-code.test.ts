import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestDb } from "../test/test-helpers.js";
import type { Spec } from "./gate.js";
import { toPostgresTable, toZod } from "./generators.js";

// The unit tests check the text. These check that the text actually works:
// the Zod code runs and validates, and the SQL creates a table that enforces the rules.
const spec: Spec = {
  title: "Order form",
  summary: "Uses a reserved word as a column name on purpose.",
  fields: [
    { key: "order", label: "Order", type: "string", required: true },
    { key: "quantity", label: "Quantity", type: "number", required: true },
    { key: "giftWrap", label: "Gift wrap", type: "boolean", required: false },
    { key: "deliverOn", label: "Deliver on", type: "date", required: false },
    { key: "email", label: "Email", type: "email", required: true },
    { key: "size", label: "Size", type: "enum", required: false, options: ["Small", "It's big"] },
  ],
};

const valid = { order: "Mugs", quantity: 2, giftWrap: true, deliverOn: "2026-12-01", email: "a@b.co", size: "It's big" };

describe("generated Zod code", () => {
  // Strip the import and export so the code runs as a function body with the real z passed in.
  const body = toZod(spec).replace('import { z } from "zod";', "").replace("export const", "const");
  const schema = new Function("z", `${body}\nreturn OrderFormSchema;`)(z) as z.ZodType;

  it("accepts a valid object and an object with optional fields left out", () => {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ order: "Mugs", quantity: 2, email: "a@b.co" }).success).toBe(true);
  });

  it("rejects a bad email, a bad date, an unknown option, and a missing required field", () => {
    expect(schema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, deliverOn: "12/01/2026" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, size: "Huge" }).success).toBe(false);
    expect(schema.safeParse({ quantity: 2, email: "a@b.co" }).success).toBe(false);
  });
});

describe("generated Postgres table", () => {
  const db = createTestDb();
  afterAll(() => db.$client.end());

  // Runs inside a transaction that always rolls back, so the test database is left unchanged.
  async function inRolledBackTransaction(run: (tx: typeof db) => Promise<void>) {
    await db
      .transaction(async (tx) => {
        await run(tx as unknown as typeof db);
        throw new Error("rollback");
      })
      .catch((err: Error) => {
        if (err.message !== "rollback") throw err;
      });
  }

  it("creates the table and accepts a valid row", async () => {
    await inRolledBackTransaction(async (tx) => {
      await tx.execute(sql.raw(toPostgresTable(spec)));
      await tx.execute(sql`INSERT INTO "order_form" ("order", quantity, gift_wrap, deliver_on, email, size)
        VALUES ('Mugs', 2, true, '2026-12-01', 'a@b.co', 'It''s big')`);
      const { rows } = await tx.execute(sql`SELECT count(*)::int AS n FROM "order_form"`);
      expect(rows[0].n).toBe(1);
    });
  });

  it("rejects an unknown option and a missing required column", async () => {
    await inRolledBackTransaction(async (tx) => {
      await tx.execute(sql.raw(toPostgresTable(spec)));
      await tx.execute(sql`SAVEPOINT before_bad_rows`);
      await expect(
        tx.execute(sql`INSERT INTO "order_form" ("order", quantity, email, size) VALUES ('Mugs', 2, 'a@b.co', 'Huge')`),
      ).rejects.toThrow();
      await tx.execute(sql`ROLLBACK TO SAVEPOINT before_bad_rows`);
      await expect(
        tx.execute(sql`INSERT INTO "order_form" (quantity, email) VALUES (2, 'a@b.co')`),
      ).rejects.toThrow();
    });
  });
});
