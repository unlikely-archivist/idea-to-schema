import { describe, expect, it } from "vitest";
import { createWorkersAiGenerator, WORKERS_AI_MODEL } from "./workers-ai-generator.js";

// Records the request and answers with a canned Chat Completions body.
function fakeFetch(responseBody: unknown, status = 200) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(responseBody), { status });
  };
  return { fetchFn: fetchFn as typeof fetch, requests };
}

const toolCallReply = {
  model: WORKERS_AI_MODEL,
  choices: [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_abc", type: "function", function: { name: "define_spec", arguments: '{"title":"Waitlist"}' } },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 300, completion_tokens: 120 },
};

const config = { accountId: "acct-1", apiToken: "secret-token" };

describe("Workers AI generator", () => {
  it("sends the conversation with define_spec forced and returns the tool call", async () => {
    const { fetchFn, requests } = fakeFetch(toolCallReply);
    const generateSpec = createWorkersAiGenerator({ ...config, fetchFn });

    const result = await generateSpec([{ role: "user", content: "a pottery waitlist" }]);

    expect(result).toEqual({
      toolCallId: "call_abc",
      toolInput: { title: "Waitlist" },
      usage: { inputTokens: 300, outputTokens: 120 },
      model: WORKERS_AI_MODEL,
    });

    const { url, init } = requests[0];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct-1/ai/v1/chat/completions");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret-token");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(WORKERS_AI_MODEL);
    expect(body.tools[0].function.name).toBe("define_spec");
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "define_spec" } });
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "a pottery waitlist" });
  });

  it("translates a repair round-trip into Chat Completions messages", async () => {
    const { fetchFn, requests } = fakeFetch(toolCallReply);
    const generateSpec = createWorkersAiGenerator({ ...config, fetchFn });

    await generateSpec([
      { role: "user", content: "a pottery waitlist" },
      { role: "assistant", toolCall: { id: "call_abc", input: { title: "" } } },
      { role: "tool", toolCallId: "call_abc", content: "fix these" },
    ]);

    const messages = JSON.parse(requests[0].init.body as string).messages;
    expect(messages.slice(-2)).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_abc", type: "function", function: { name: "define_spec", arguments: '{"title":""}' } }],
      },
      { role: "tool", tool_call_id: "call_abc", content: "fix these" },
    ]);
  });

  it("returns toolCallId null when the model replies in plain text", async () => {
    const { fetchFn } = fakeFetch({
      ...toolCallReply,
      choices: [{ message: { role: "assistant", content: "Here is your form..." } }],
    });
    const result = await createWorkersAiGenerator({ ...config, fetchFn })([{ role: "user", content: "x" }]);

    expect(result.toolCallId).toBeNull();
  });

  it("passes unparseable arguments through so the gate rejects them", async () => {
    const reply = structuredClone(toolCallReply);
    reply.choices[0].message.tool_calls[0].function.arguments = "{not json";
    const { fetchFn } = fakeFetch(reply);
    const result = await createWorkersAiGenerator({ ...config, fetchFn })([{ role: "user", content: "x" }]);

    expect(result.toolInput).toBe("{not json");
  });

  it("reads GLM's native tool-call text when Workers AI leaves it unconverted", async () => {
    // Seen from the real API on 2026-11-25: the arguments field held the model's raw format.
    const reply = structuredClone(toolCallReply);
    reply.choices[0].message.tool_calls[0].function.arguments =
      "<tool_call>define_spec<arg_key>title</arg_key><arg_value>Pottery Waitlist</arg_value>\n" +
      "<arg_key>summary</arg_key><arg_value>Join the list</arg_value>\n" +
      '<arg_key>fields</arg_key><arg_value>[{"key": "fullName", "label": "Full name", "type": "string", "required": true}]</arg_value></tool_call>';
    const { fetchFn } = fakeFetch(reply);
    const result = await createWorkersAiGenerator({ ...config, fetchFn })([{ role: "user", content: "x" }]);

    expect(result.toolInput).toEqual({
      title: "Pottery Waitlist",
      summary: "Join the list",
      fields: [{ key: "fullName", label: "Full name", type: "string", required: true }],
    });
  });

  it("throws on an HTTP error without leaking the token", async () => {
    const { fetchFn } = fakeFetch({ errors: [{ message: "quota exceeded" }] }, 429);
    const generateSpec = createWorkersAiGenerator({ ...config, fetchFn });

    const error = await generateSpec([{ role: "user", content: "x" }]).catch((e: Error) => e);
    expect((error as Error).message).toContain("429");
    expect((error as Error).message).not.toContain("secret-token");
  });
});
