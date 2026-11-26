import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { revisions } from "./db/schema.js";
import { createTestDb, fakeGenerator, truncateAll, validSpec } from "./test/test-helpers.js";

const db = createTestDb();

beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

// Creates a spec and saves `count` generated revisions through the real routes.
async function specWithRevisions(count: number) {
  const fake = fakeGenerator(Array(count).fill(validSpec));
  const app = createApp(db, fake.generateSpec);
  const { id: specId } = (await (await app.request("/api/specs", { method: "POST" })).json()) as { id: string };
  const saved = [];
  for (let i = 0; i < count; i++) {
    const res = await app.request(`/api/specs/${specId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ prompt: `prompt ${i + 1}` }),
    });
    saved.push(await res.json());
  }
  return { app, specId, saved };
}

function restore(app: ReturnType<typeof createApp>, specId: string, revId: string) {
  return app.request(`/api/specs/${specId}/revisions/${revId}/restore`, { method: "POST" });
}

describe("GET /api/specs/:id/revisions", () => {
  it("lists revisions newest first with generated output", async () => {
    const { app, specId } = await specWithRevisions(2);

    const res = await app.request(`/api/specs/${specId}/revisions`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((r: { version: number }) => r.version)).toEqual([2, 1]);
    expect(body[0].typescript).toContain("interface PotteryWaitlist");
    expect(body[0].jsonSchema.required).toEqual(["fullName"]);
  });

  it("returns an empty list for a spec with no revisions", async () => {
    const { app, specId } = await specWithRevisions(0);
    const res = await app.request(`/api/specs/${specId}/revisions`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns 404 for an unknown spec", async () => {
    const { app } = await specWithRevisions(0);
    expect((await app.request(`/api/specs/${randomUUID()}/revisions`)).status).toBe(404);
    expect((await app.request(`/api/specs/not-a-uuid/revisions`)).status).toBe(404);
  });
});

describe("POST /api/specs/:id/revisions/:revId/restore", () => {
  // Test 5: restore
  it("creates version n+1 copying the old revision and leaves the old row unchanged", async () => {
    const { app, specId, saved } = await specWithRevisions(2);
    const [oldRowBefore] = await db.select().from(revisions).where(eq(revisions.id, saved[0].id));

    const res = await restore(app, specId, saved[0].id);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      specId,
      version: 3,
      restoredFrom: saved[0].id,
      prompt: "prompt 1",
      specJson: validSpec,
      attempts: 0,
      idempotencyKey: null,
      inputTokens: null,
      outputTokens: null,
      latencyMs: null,
      model: null,
    });
    expect(body.typescript).toContain("interface PotteryWaitlist");

    const [oldRowAfter] = await db.select().from(revisions).where(eq(revisions.id, saved[0].id));
    expect(oldRowAfter).toEqual(oldRowBefore);
    expect(await db.select().from(revisions)).toHaveLength(3);
  });

  it("returns 404 for an unknown revision, or one that belongs to another spec", async () => {
    const first = await specWithRevisions(1);
    const second = await specWithRevisions(1);

    expect((await restore(first.app, first.specId, randomUUID())).status).toBe(404);
    expect((await restore(first.app, first.specId, "not-a-uuid")).status).toBe(404);
    expect((await restore(first.app, "not-a-uuid", first.saved[0].id)).status).toBe(404);
    expect((await restore(first.app, first.specId, second.saved[0].id)).status).toBe(404);
    expect(await db.select().from(revisions)).toHaveLength(2);
  });
});

// Test 7: concurrency
describe("simultaneous revisions for the same spec", () => {
  it("never saves a duplicate version: the results are new versions in sequence, or 409s", async () => {
    const { app, specId, saved } = await specWithRevisions(1);

    const responses = await Promise.all(Array.from({ length: 5 }, () => restore(app, specId, saved[0].id)));

    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    expect(statuses).toContain(201);

    const versions = (await db.select().from(revisions).where(eq(revisions.specId, specId)))
      .map((r) => r.version)
      .sort((a, b) => a - b);
    const created = statuses.filter((s) => s === 201).length;
    // Versions 1..n with no gaps or repeats, one per successful request.
    expect(versions).toEqual(Array.from({ length: created + 1 }, (_, i) => i + 1));
  });

  // The test above may not collide on every run, so this one forces the collision.
  it("returns 409 when another request saves the same version first", async () => {
    const { app, specId, saved } = await specWithRevisions(1);

    // Hold version 2 in an open transaction. The restore can't see it, so it also picks version 2.
    const other = await db.$client.connect();
    try {
      await other.query("BEGIN");
      await other.query(
        "INSERT INTO revisions (spec_id, version, prompt, spec_json, attempts) VALUES ($1, 2, 'other', $2, 0)",
        [specId, JSON.stringify(validSpec)],
      );

      const pending = restore(app, specId, saved[0].id);
      // Commit only once the restore is blocked waiting on the version constraint.
      await expect.poll(async () => {
        const { rows } = await other.query("SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted");
        return rows[0].n;
      }).toBeGreaterThan(0);
      await other.query("COMMIT");

      const res = await pending;
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: expect.stringContaining("Refresh and try again") });
    } finally {
      other.release();
    }
    expect(await db.select().from(revisions)).toHaveLength(2);
  });
});
