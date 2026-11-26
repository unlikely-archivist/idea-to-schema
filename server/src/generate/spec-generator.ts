// The one seam between our code and the model. The real adapter (step 6)
// turns these messages into the provider's format and calls it; tests pass
// a fake that returns canned tool inputs. Nothing here is provider-specific.
export type SpecGenerator = (messages: Message[]) => Promise<GeneratorResult>;

export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; toolCall: { id: string; input: unknown } }
  | { role: "tool"; toolCallId: string; content: string }; // our reply to a tool call

export type GeneratorResult = {
  toolCallId: string; // lets a repair retry reply to this exact call
  toolInput: unknown; // untrusted until it passes checkSpec
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};
