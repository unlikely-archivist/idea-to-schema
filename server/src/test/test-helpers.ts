import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "../db/client.js";
import type { GeneratorResult, Message, SpecGenerator } from "../generate/spec-generator.js";

export function createTestDb() {
  if (existsSync(".env")) process.loadEnvFile();
  return createDb(process.env.TEST_DATABASE_URL!);
}

export async function truncateAll(db: Db) {
  await db.execute(sql`TRUNCATE revisions, specs, daily_usage`);
}

// Pass this in place of a tool input to make the fake reply without calling define_spec.
export const NO_TOOL_CALL = Symbol("no tool call");

// A stand-in for the model: returns the given tool inputs in order and
// records the messages it received on each call.
export function fakeGenerator(toolInputs: unknown[]) {
  const calls: Message[][] = [];
  const generateSpec: SpecGenerator = async (messages) => {
    calls.push(messages);
    const toolInput = toolInputs[calls.length - 1];
    const result: GeneratorResult = {
      toolCallId: toolInput === NO_TOOL_CALL ? null : `call-${calls.length}`,
      toolInput: toolInput === NO_TOOL_CALL ? undefined : toolInput,
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "fake-model",
    };
    return result;
  };
  return { generateSpec, calls };
}

export const validSpec = {
  title: "Pottery waitlist",
  summary: "Join the waitlist for the next pottery class.",
  fields: [
    { key: "fullName", label: "Full name", type: "string", required: true },
    { key: "level", label: "Level", type: "enum", required: false, options: ["Beginner", "Returning"] },
  ],
};

// Fails the gate: the key isn't camelCase.
export const invalidSpec = {
  ...validSpec,
  fields: [{ key: "Full Name", label: "Full name", type: "string", required: true }],
};
