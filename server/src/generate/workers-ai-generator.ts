import type { Message, SpecGenerator } from "./spec-generator.js";

// Free-plan model with function calling. Re-check the catalog if requests start failing.
export const WORKERS_AI_MODEL = "@cf/zai-org/glm-4.7-flash";

const SYSTEM_PROMPT =
  "You design data-entry forms. Turn the user's idea into a form spec by calling define_spec. " +
  "Field keys are unique camelCase. Use type enum only with 2-20 options; other types have no options.";

// The tool from docs/build-spec.md, in Chat Completions format.
const DEFINE_SPEC_TOOL = {
  type: "function",
  function: {
    name: "define_spec",
    description: "Define the form: a title, a one-line summary, and its fields.",
    parameters: {
      type: "object",
      required: ["title", "summary", "fields"],
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        fields: {
          type: "array",
          items: {
            type: "object",
            required: ["key", "label", "type", "required"],
            properties: {
              key: { type: "string" },
              label: { type: "string" },
              type: { enum: ["string", "text", "number", "boolean", "date", "email", "enum"] },
              required: { type: "boolean" },
              options: { type: "array", items: { type: "string" } },
              help: { type: "string" },
            },
          },
        },
      },
    },
  },
};

// Only the parts of the response we read.
type ChatCompletion = {
  model?: string;
  choices: { message: { tool_calls?: { id: string; function: { arguments: string } }[] } }[];
  usage: { prompt_tokens: number; completion_tokens: number };
};

type Config = {
  accountId: string;
  apiToken: string;
  fetchFn?: typeof fetch; // tests pass a fake
};

export function createWorkersAiGenerator({ accountId, apiToken, fetchFn = fetch }: Config): SpecGenerator {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;

  return async (messages) => {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: WORKERS_AI_MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages.map(toChatMessage)],
        tools: [DEFINE_SPEC_TOOL],
        tool_choice: { type: "function", function: { name: "define_spec" } },
      }),
    });
    if (!res.ok) {
      throw new Error(`Workers AI request failed: ${res.status} ${(await res.text()).slice(0, 500)}`);
    }

    const data = (await res.json()) as ChatCompletion;
    const toolCall = data.choices[0]?.message.tool_calls?.[0];
    return {
      toolCallId: toolCall?.id ?? null,
      toolInput: toolCall ? parseArguments(toolCall.function.arguments) : undefined,
      usage: { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens },
      model: data.model ?? WORKERS_AI_MODEL,
    };
  };
}

function toChatMessage(message: Message) {
  switch (message.role) {
    case "user":
      return message;
    case "assistant":
      return {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: message.toolCall.id,
            type: "function",
            function: { name: "define_spec", arguments: JSON.stringify(message.toolCall.input) },
          },
        ],
      };
    case "tool":
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
}

// Bad JSON goes through as a string, so the gate rejects it and the repair retry runs.
function parseArguments(args: string): unknown {
  try {
    return JSON.parse(args);
  } catch {
    return args.trimStart().startsWith("<tool_call>") ? parseGlmToolCall(args) : args;
  }
}

// Workers AI sometimes skips converting GLM's native tool-call text to JSON and returns
// it as-is: <tool_call>name<arg_key>k</arg_key><arg_value>v</arg_value>...</tool_call>.
// GLM writes string values raw and arrays or objects as JSON.
function parseGlmToolCall(text: string): unknown {
  const input: Record<string, unknown> = {};
  for (const [, key, value] of text.matchAll(/<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g)) {
    input[key.trim()] = /^\s*[[{]/.test(value) ? parseArguments(value) : value;
  }
  return input;
}
