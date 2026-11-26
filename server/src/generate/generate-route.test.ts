import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { revisions } from "../db/schema.js";
import { createTestDb, fakeGenerator, invalidSpec, truncateAll, validSpec } from "../test/test-helpers.js";
import { MAX_ATTEMPTS } from "./generate-with-repair.js";
import type { SpecGenerator } from "./spec-generator.js";

const db = createTestDb();

beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

async function createSpec(generateSpec: SpecGenerator) {
  const app = createApp(db, generateSpec);
  const res = await app.request("/api/specs", { method: "POST" });
  const { id } = (await res.json()) as { id: string };
  return { app, specId: id };
}

function generate(app: ReturnType<typeof createApp>, specId: string, key: string | null, body: unknown) {
  return app.request(`/api/specs/${specId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    body: JSON.stringify(body),
  });
}

describe("POST /api/specs/:id/generate", () => {
  it("saves a revision with generated output when the first attempt passes", async () => {
    const fake = fakeGenerator([validSpec]);
    const { app, specId } = await createSpec(fake.generateSpec);

    const res = await generate(app, specId, randomUUID(), { prompt: "a pottery waitlist" });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ specId, version: 1, attempts: 1, inputTokens: 100, model: "fake-model" });
    expect(body.typescript).toContain("interface PotteryWaitlist");
    expect(body.jsonSchema.required).toEqual(["fullName"]);
  });

  // Test 2: repair retry
  it("retries once with the error list and saves attempts = 2", async () => {
    const fake = fakeGenerator([invalidSpec, validSpec]);
    const { app, specId } = await createSpec(fake.generateSpec);

    const res = await generate(app, specId, randomUUID(), { prompt: "a pottery waitlist" });

    expect(res.status).toBe(201);
    expect((await res.json()).attempts).toBe(2);

    const secondCall = fake.calls[1];
    expect(secondCall[1]).toEqual({ role: "assistant", toolCall: { id: "call-1", input: invalidSpec } });
    expect(secondCall[2]).toMatchObject({ role: "tool", toolCallId: "call-1" });
    expect(secondCall[2]).toHaveProperty("content", expect.stringContaining('fields[0].key: "Full Name" must be camelCase'));
  });

  // Test 3: retry cap
  it("stops after two failed attempts, returns 422, and saves nothing", async () => {
    const fake = fakeGenerator([invalidSpec, invalidSpec, validSpec]);
    const { app, specId } = await createSpec(fake.generateSpec);

    const res = await generate(app, specId, randomUUID(), { prompt: "a pottery waitlist" });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.details).toEqual([expect.stringContaining("must be camelCase")]);
    expect(fake.calls).toHaveLength(MAX_ATTEMPTS);
    expect(MAX_ATTEMPTS).toBe(2);
    expect(await db.select().from(revisions)).toHaveLength(0);
  });

  // Test 4: idempotency
  it("replays the same Idempotency-Key without a second model call", async () => {
    const fake = fakeGenerator([validSpec, validSpec]);
    const { app, specId } = await createSpec(fake.generateSpec);
    const key = randomUUID();

    const first = await generate(app, specId, key, { prompt: "a pottery waitlist" });
    const second = await generate(app, specId, key, { prompt: "a pottery waitlist" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((await second.json()).id).toBe((await first.json()).id);
    expect(fake.calls).toHaveLength(1);
    expect(await db.select().from(revisions)).toHaveLength(1);
  });

  it("returns the winner's revision when two requests with the same key race", async () => {
    // Hold both model calls until both requests have passed the replay lookup,
    // so they really do race to insert.
    const fake = fakeGenerator([validSpec, validSpec]);
    let releaseBoth = () => {};
    const bothArrived = new Promise<void>((resolve) => (releaseBoth = resolve));
    const racingGenerator: SpecGenerator = async (messages) => {
      const result = fake.generateSpec(messages);
      if (fake.calls.length === 2) releaseBoth();
      await bothArrived;
      return result;
    };
    const { app, specId } = await createSpec(racingGenerator);
    const key = randomUUID();

    const responses = await Promise.all([
      generate(app, specId, key, { prompt: "a pottery waitlist" }),
      generate(app, specId, key, { prompt: "a pottery waitlist" }),
    ]);

    expect(fake.calls).toHaveLength(2);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    const [a, b] = await Promise.all(responses.map((r) => r.json()));
    expect(a.id).toBe(b.id);
    expect(await db.select().from(revisions)).toHaveLength(1);
  });

  it("rejects bad requests before calling the model", async () => {
    const fake = fakeGenerator([]);
    const { app, specId } = await createSpec(fake.generateSpec);
    const key = randomUUID();

    expect((await generate(app, specId, null, { prompt: "x" })).status).toBe(400);
    expect((await generate(app, specId, "not-a-uuid", { prompt: "x" })).status).toBe(400);
    expect((await generate(app, specId, key, { prompt: "" })).status).toBe(400);
    expect((await generate(app, specId, key, { prompt: "x".repeat(2001) })).status).toBe(400);
    expect((await generate(app, randomUUID(), key, { prompt: "x" })).status).toBe(404);
    expect((await generate(app, "not-a-uuid", key, { prompt: "x" })).status).toBe(404);
    expect(fake.calls).toHaveLength(0);
  });
});
