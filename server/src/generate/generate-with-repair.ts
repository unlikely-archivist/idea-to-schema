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

    // Same conversation: the model's tool call, then our error list as the reply to it.
    messages = [
      ...messages,
      { role: "assistant", toolCall: { id: result.toolCallId, input: result.toolInput } },
      {
        role: "tool",
        toolCallId: result.toolCallId,
        content: `The spec failed validation. Call define_spec again with these fixed:\n${errors.map((e) => `- ${e}`).join("\n")}`,
      },
    ];
  }

  return { ok: false, errors };
}
