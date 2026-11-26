import { checkSpec, type Spec } from "../spec/gate.js";
import type { Message, SpecGenerator } from "./spec-generator.js";

// Attempt 1, plus one repair retry. Never more.
export const MAX_ATTEMPTS = 2;

export type GenerationResult =
  | {
      ok: true;
      spec: Spec;
      attempts: number;
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
      model: string;
    }
  | { ok: false; errors: string[] };

export async function generateWithRepair(
  prompt: string,
  generateSpec: SpecGenerator,
): Promise<GenerationResult> {
  const started = performance.now();
  let messages: Message[] = [{ role: "user", content: prompt }];
  let inputTokens = 0;
  let outputTokens = 0;
  let errors: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await generateSpec(messages);
    inputTokens += result.usage.inputTokens;
    outputTokens += result.usage.outputTokens;

    // Replied in plain text instead of calling the tool: a failed attempt, and
    // there's no tool call to reply to, so nudge with a user message instead.
    if (result.toolCallId === null) {
      errors = ["The model replied without calling define_spec"];
      messages = [...messages, { role: "user", content: "Reply only by calling define_spec." }];
      continue;
    }

    const gate = checkSpec(result.toolInput);
    if (gate.ok) {
      return {
        ok: true,
        spec: gate.spec,
        attempts: attempt,
        inputTokens,
        outputTokens,
        latencyMs: Math.round(performance.now() - started),
        model: result.model,
      };
    }
    errors = gate.errors;
    const fixRequest = `The spec failed validation. Call define_spec again with these fixed:\n${errors.map((e) => `- ${e}`).join("\n")}`;

    // Tool call arguments must be an object. If the model's weren't (bad JSON, say),
    // echoing them back is an invalid message the provider rejects, so ask in plain text.
    if (!isPlainObject(result.toolInput)) {
      messages = [...messages, { role: "user", content: fixRequest }];
      continue;
    }

    // Same conversation: the model's tool call, then our error list as the reply to it.
    messages = [
      ...messages,
      { role: "assistant", toolCall: { id: result.toolCallId, input: result.toolInput } },
      {
        role: "tool",
        toolCallId: result.toolCallId,
        content: fixRequest,
      },
    ];
  }

  return { ok: false, errors };
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
