import { and, desc, eq, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Db } from "./db/client.js";
import { insertRevision, uniqueViolation, type Revision } from "./db/insert-revision.js";
import { dailyUsage, revisions, specs } from "./db/schema.js";
import { generateWithRepair } from "./generate/generate-with-repair.js";
import type { SpecGenerator } from "./generate/spec-generator.js";
import { toJsonSchema, toPostgresTable, toTypeScript, toZod } from "./spec/generators.js";

const GenerateBody = z.object({ prompt: z.string().min(1).max(2000) });
const Uuid = z.uuid();

// Keeps the live demo inside Workers AI's free 10,000 neurons a day. GLM-4.7-Flash costs
// 5,500 neurons per million input tokens and 36,400 per million output tokens (checked 2026-11-25).
// A typical generation (371 in, 540 out) is about 22 neurons; with a repair retry, about 50.
// 150 worst-case generations is about 7,500 neurons.
export const DAILY_GENERATION_CAP = 150;

export interface Limits {
  // Per-IP rate limit on POST requests. Returns false when the IP is over its limit.
  allowRequest: (ip: string) => Promise<boolean>;
  dailyCap: number;
}

// Local dev has no rate limiter; the Worker passes Cloudflare's (see worker.ts).
const defaultLimits: Limits = { allowRequest: async () => true, dailyCap: DAILY_GENERATION_CAP };

// Dependencies are passed in so tests can use a test database, a fake generator, and test limits.
export function createApp(db: Db, generateSpec: SpecGenerator, limits: Limits = defaultLimits) {
  const app = new Hono();

  // POST routes write rows, so they are rate limited. Cloudflare sets CF-Connecting-IP.
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "POST") {
      const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
      if (!(await limits.allowRequest(ip))) {
        return c.json({ error: "Too many requests. Wait a minute and try again." }, 429);
      }
    }
    await next();
  });

  // Keep the { error } shape for unexpected failures too, such as the database being unreachable.
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "Something went wrong on the server. Try again." }, 500);
  });

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

    // Counted before the model call, because failed attempts use neurons too.
    if (!(await reserveDailyGeneration(db, limits.dailyCap))) {
      return c.json({ error: "The demo's daily generation limit is reached. Try again after 00:00 UTC." }, 429);
    }

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
      if (constraint === VERSION_CONSTRAINT) return versionConflict(c);
      throw err;
    }
  });

  app.get("/api/specs/:id/revisions", async (c) => {
    const specId = c.req.param("id");
    if (!Uuid.safeParse(specId).success) return c.json({ error: "Spec not found" }, 404);

    const spec = await db.query.specs.findFirst({ where: eq(specs.id, specId) });
    if (!spec) return c.json({ error: "Spec not found" }, 404);

    const rows = await db.query.revisions.findMany({
      where: eq(revisions.specId, specId),
      orderBy: desc(revisions.version),
    });
    return c.json(rows.map(toResponse), 200);
  });

  app.post("/api/specs/:id/revisions/:revId/restore", async (c) => {
    const specId = c.req.param("id");
    const revId = c.req.param("revId");
    if (!Uuid.safeParse(specId).success || !Uuid.safeParse(revId).success) {
      return c.json({ error: "Revision not found" }, 404);
    }

    // Matching on spec_id too stops a revision from one spec being restored into another.
    const source = await db.query.revisions.findFirst({
      where: and(eq(revisions.id, revId), eq(revisions.specId, specId)),
    });
    if (!source) return c.json({ error: "Revision not found" }, 404);

    // A restore is a new row that copies the old one; the old row is never edited.
    try {
      const row = await insertRevision(db, {
        specId,
        prompt: source.prompt,
        specJson: source.specJson,
        restoredFrom: source.id,
        attempts: 0,
      });
      return c.json(toResponse(row), 201);
    } catch (err) {
      if (uniqueViolation(err) === VERSION_CONSTRAINT) return versionConflict(c);
      throw err;
    }
  });

  return app;
}

const VERSION_CONSTRAINT = "revisions_spec_id_version_unique";

function versionConflict(c: Context) {
  return c.json({ error: "Another revision was saved at the same time. Refresh and try again." }, 409);
}

// Adds one to today's count unless it has reached the cap. One statement, so two
// simultaneous requests can't both take the last slot. Returns false at the cap.
async function reserveDailyGeneration(db: Db, cap: number) {
  const rows = await db
    .insert(dailyUsage)
    .values({ day: sql`(now() at time zone 'utc')::date`, generations: 1 })
    .onConflictDoUpdate({
      target: dailyUsage.day,
      set: { generations: sql`${dailyUsage.generations} + 1` },
      setWhere: sql`${dailyUsage.generations} < ${cap}`,
    })
    .returning();
  return rows.length > 0;
}

function findByIdempotencyKey(db: Db, specId: string, idempotencyKey: string) {
  return db.query.revisions.findFirst({
    where: and(eq(revisions.specId, specId), eq(revisions.idempotencyKey, idempotencyKey)),
  });
}

// The outputs are generated on read, never stored.
function toResponse(row: Revision) {
  return {
    ...row,
    jsonSchema: toJsonSchema(row.specJson),
    typescript: toTypeScript(row.specJson),
    zod: toZod(row.specJson),
    sql: toPostgresTable(row.specJson),
  };
}
