import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "./db/client.js";
import { insertRevision, uniqueViolation, type Revision } from "./db/insert-revision.js";
import { revisions, specs } from "./db/schema.js";
import { generateWithRepair } from "./generate/generate-with-repair.js";
import type { SpecGenerator } from "./generate/spec-generator.js";
import { toJsonSchema, toTypeScript } from "./spec/generators.js";

const GenerateBody = z.object({ prompt: z.string().min(1).max(2000) });
const Uuid = z.uuid();

// Dependencies are passed in so tests can use a test database and a fake generator.
export function createApp(db: Db, generateSpec: SpecGenerator) {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.post("/api/specs", async (c) => {
    const [spec] = await db.insert(specs).values({}).returning({ id: specs.id });
    return c.json({ id: spec.id }, 201);
  });

  app.post("/api/specs/:id/generate", async (c) => {
    const specId = c.req.param("id");
    // A non-UUID id can't match any spec; checking here avoids a Postgres cast error.
    if (!Uuid.safeParse(specId).success) return c.json({ error: "Spec not found" }, 404);

    const idempotencyKey = c.req.header("Idempotency-Key");
    if (!idempotencyKey || !Uuid.safeParse(idempotencyKey).success) {
      return c.json({ error: "Idempotency-Key header must be a UUID" }, 400);
    }

    const body = GenerateBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: "Body must be { prompt } with 1 to 2,000 characters" }, 400);
    }

    const spec = await db.query.specs.findFirst({ where: eq(specs.id, specId) });
    if (!spec) return c.json({ error: "Spec not found" }, 404);

    // Replay: this click was already handled, so return it without calling the model.
    const existing = await findByIdempotencyKey(db, specId, idempotencyKey);
    if (existing) return c.json(toResponse(existing), 200);

    const result = await generateWithRepair(body.data.prompt, generateSpec);
    if (!result.ok) {
      return c.json({ error: "The model's output failed validation twice", details: result.errors }, 422);
    }

    try {
      const row = await insertRevision(db, {
        specId,
        prompt: body.data.prompt,
        specJson: result.spec,
        idempotencyKey,
        attempts: result.attempts,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
        model: result.model,
      });
      return c.json(toResponse(row), 201);
    } catch (err) {
      const constraint = uniqueViolation(err);
      if (constraint) {
        // Two requests with the same key raced past the lookup and the other one won.
        // Postgres may report the version constraint instead of the key one, so check
        // for the winner whichever constraint fired.
        const winner = await findByIdempotencyKey(db, specId, idempotencyKey);
        if (winner) return c.json(toResponse(winner), 200);
      }
      if (constraint === "revisions_spec_id_version_unique") {
        return c.json({ error: "Another revision was saved at the same time. Refresh and try again." }, 409);
      }
      throw err;
    }
  });

  return app;
}

function findByIdempotencyKey(db: Db, specId: string, idempotencyKey: string) {
  return db.query.revisions.findFirst({
    where: and(eq(revisions.specId, specId), eq(revisions.idempotencyKey, idempotencyKey)),
  });
}

// jsonSchema and typescript are generated on read, never stored.
function toResponse(row: Revision) {
  return { ...row, jsonSchema: toJsonSchema(row.specJson), typescript: toTypeScript(row.specJson) };
}
