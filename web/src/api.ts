// The only module that talks to the server. Types mirror server/src/app.ts responses.

export type FieldType = "string" | "text" | "number" | "boolean" | "date" | "email" | "enum";

export type Field = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  help?: string;
};

export type Spec = { title: string; summary: string; fields: Field[] };

export type Revision = {
  id: string;
  specId: string;
  version: number;
  prompt: string;
  specJson: Spec;
  restoredFrom: string | null;
  attempts: number;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  model: string | null;
  createdAt: string;
  jsonSchema: object;
  typescript: string;
  zod: string;
  sql: string;
};

// Thrown for any non-2xx response, carrying the server's { error, details? } body.
export class ApiError extends Error {
  status: number;
  details: string[];

  constructor(status: number, message: string, details: string[] = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`, body?.details);
  }
  return body as T;
}

export function createSpec(): Promise<{ id: string }> {
  return request("/api/specs", { method: "POST" });
}

export function listRevisions(specId: string): Promise<Revision[]> {
  return request(`/api/specs/${specId}/revisions`);
}

// The caller makes idempotencyKey once per click, so a resent request can't save twice.
export function generate(specId: string, prompt: string, idempotencyKey: string): Promise<Revision> {
  return request(`/api/specs/${specId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ prompt }),
  });
}

export function restore(specId: string, revisionId: string): Promise<Revision> {
  return request(`/api/specs/${specId}/revisions/${revisionId}/restore`, { method: "POST" });
}
