import type { Field, Spec } from "./gate.js";

// Both functions take a spec that already passed checkSpec.

export function toJsonSchema(spec: Spec) {
  const properties: Record<string, object> = {};
  for (const field of spec.fields) {
    properties[field.key] = {
      ...jsonSchemaType(field),
      title: field.label,
      ...(field.help ? { description: field.help } : {}),
    };
  }

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: spec.title,
    description: spec.summary,
    type: "object",
    properties,
    required: spec.fields.filter((field) => field.required).map((field) => field.key),
  };
}

function jsonSchemaType(field: Field): object {
  switch (field.type) {
    case "string":
    case "text":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "date":
      return { type: "string", format: "date" };
    case "email":
      return { type: "string", format: "email" };
    case "enum":
      return { type: "string", enum: field.options };
  }
}

export function toTypeScript(spec: Spec): string {
  const lines = spec.fields.map((field) => {
    const optional = field.required ? "" : "?";
    return `  ${field.key}${optional}: ${typeScriptType(field)};`;
  });
  return `export interface ${toPascalCase(spec.title)} {\n${lines.join("\n")}\n}\n`;
}

function typeScriptType(field: Field): string {
  switch (field.type) {
    case "string":
    case "text":
    case "date":
    case "email":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "enum":
      // JSON.stringify quotes and escapes each option as a valid TS string literal.
      return (field.options ?? []).map((option) => JSON.stringify(option)).join(" | ");
  }
}

// "Pottery class waitlist!" -> "PotteryClassWaitlist"
export function toPascalCase(title: string): string {
  const name = title
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word !== "")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("");
  // An identifier can't be empty or start with a digit.
  return /^[A-Za-z]/.test(name) ? name : `Spec${name}`;
}
