import type { Field, Spec } from "./gate.js";

// Every function here takes a spec that already passed checkSpec.

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

// Zod 4 code that validates the same shape as the interface.
export function toZod(spec: Spec): string {
  const lines = spec.fields.map((field) => {
    const optional = field.required ? "" : ".optional()";
    return `  ${field.key}: ${zodType(field)}${optional},`;
  });
  const name = `${toPascalCase(spec.title)}Schema`;
  return `import { z } from "zod";\n\nexport const ${name} = z.object({\n${lines.join("\n")}\n});\n`;
}

function zodType(field: Field): string {
  switch (field.type) {
    case "string":
    case "text":
      return "z.string()";
    case "number":
      return "z.number()";
    case "boolean":
      return "z.boolean()";
    case "date":
      return "z.iso.date()";
    case "email":
      return "z.email()";
    case "enum":
      return `z.enum([${(field.options ?? []).map((option) => JSON.stringify(option)).join(", ")}])`;
  }
}

// A Postgres table with one column per field, plus a generated primary key.
// Every identifier is double-quoted, so reserved words like "order" or "user" still work.
export function toPostgresTable(spec: Spec): string {
  const columns = spec.fields.map((field) => toSnakeCase(field.key));
  // A field can't become the primary key's name; keys are unique, so only "id" can clash.
  const idColumn = columns.includes("id") ? "record_id" : "id";
  const lines = [`  "${idColumn}" uuid PRIMARY KEY DEFAULT gen_random_uuid()`];
  spec.fields.forEach((field, i) => {
    const notNull = field.required ? " NOT NULL" : "";
    lines.push(`  "${columns[i]}" ${postgresType(field, columns[i])}${notNull}`);
  });
  return `CREATE TABLE "${toSnakeCase(toPascalCase(spec.title))}" (\n${lines.join(",\n")}\n);\n`;
}

function postgresType(field: Field, column: string): string {
  switch (field.type) {
    case "string":
    case "text":
    case "email":
      return "text";
    case "number":
      return "numeric";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "enum": {
      // A single quote inside a SQL string literal is written as two.
      const options = (field.options ?? []).map((option) => `'${option.replaceAll("'", "''")}'`);
      return `text CHECK ("${column}" IN (${options.join(", ")}))`;
    }
  }
}

// "fullName" -> "full_name", "PotteryClassWaitlist" -> "pottery_class_waitlist".
// Keys have no underscores, so two different keys never map to the same column.
export function toSnakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter, i) => (i === 0 ? "" : "_") + letter.toLowerCase());
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
