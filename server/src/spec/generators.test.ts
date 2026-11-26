import { describe, expect, it } from "vitest";
import type { Spec } from "./gate.js";
import { toJsonSchema, toPascalCase, toPostgresTable, toSnakeCase, toTypeScript, toZod } from "./generators.js";

// One field of every type, half required and half optional.
const spec: Spec = {
  title: "Pottery class waitlist",
  summary: "Collects sign-ups for a full pottery class.",
  fields: [
    { key: "fullName", label: "Full name", type: "string", required: true },
    { key: "notes", label: "Notes", type: "text", required: false, help: "Anything we should know" },
    { key: "age", label: "Age", type: "number", required: true },
    { key: "hasClay", label: "Own clay?", type: "boolean", required: false },
    { key: "startDate", label: "Start date", type: "date", required: true },
    { key: "email", label: "Email", type: "email", required: true },
    {
      key: "level",
      label: "Level",
      type: "enum",
      required: false,
      options: ["Beginner", 'Says "hi"'],
    },
  ],
};

describe("toJsonSchema", () => {
  const schema = toJsonSchema(spec);

  it("builds a draft 2020-12 object schema", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.type).toBe("object");
    expect(schema.title).toBe("Pottery class waitlist");
    expect(schema.description).toBe("Collects sign-ups for a full pottery class.");
  });

  it("maps each field type", () => {
    expect(schema.properties).toEqual({
      fullName: { type: "string", title: "Full name" },
      notes: { type: "string", title: "Notes", description: "Anything we should know" },
      age: { type: "number", title: "Age" },
      hasClay: { type: "boolean", title: "Own clay?" },
      startDate: { type: "string", format: "date", title: "Start date" },
      email: { type: "string", format: "email", title: "Email" },
      level: { type: "string", enum: ["Beginner", 'Says "hi"'], title: "Level" },
    });
  });

  it("lists only required fields as required", () => {
    expect(schema.required).toEqual(["fullName", "age", "startDate", "email"]);
  });
});

describe("toTypeScript", () => {
  const lines = toTypeScript(spec).split("\n");

  it("names the interface from the title in PascalCase", () => {
    expect(lines[0]).toBe("export interface PotteryClassWaitlist {");
  });

  it("maps each field type and marks optional fields with ?", () => {
    expect(lines.slice(1, -2)).toEqual([
      "  fullName: string;",
      "  notes?: string;",
      "  age: number;",
      "  hasClay?: boolean;",
      "  startDate: string;",
      "  email: string;",
      '  level?: "Beginner" | "Says \\"hi\\"";',
    ]);
    expect(lines.slice(-2)).toEqual(["}", ""]);
  });
});

describe("toPascalCase", () => {
  it("joins words and capitalizes each one", () => {
    expect(toPascalCase("pottery class waitlist!")).toBe("PotteryClassWaitlist");
    expect(toPascalCase("RSVP form")).toBe("RSVPForm");
  });

  it("returns a valid identifier when the title starts with a digit or has no letters", () => {
    expect(toPascalCase("2026 signups")).toBe("Spec2026Signups");
    expect(toPascalCase("!!!")).toBe("Spec");
  });
});

describe("toZod", () => {
  const lines = toZod(spec).split("\n");

  it("exports a schema named from the title", () => {
    expect(lines[0]).toBe('import { z } from "zod";');
    expect(lines[2]).toBe("export const PotteryClassWaitlistSchema = z.object({");
  });

  it("maps each field type and marks optional fields with .optional()", () => {
    expect(lines.slice(3, 10)).toEqual([
      "  fullName: z.string(),",
      "  notes: z.string().optional(),",
      "  age: z.number(),",
      "  hasClay: z.boolean().optional(),",
      "  startDate: z.iso.date(),",
      "  email: z.email(),",
      '  level: z.enum(["Beginner", "Says \\"hi\\""]).optional(),',
    ]);
  });
});

describe("toPostgresTable", () => {
  const lines = toPostgresTable(spec).split("\n");

  it("names the table from the title in snake_case and adds a uuid primary key", () => {
    expect(lines[0]).toBe('CREATE TABLE "pottery_class_waitlist" (');
    expect(lines[1]).toBe('  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),');
  });

  it("maps each field type and marks required fields NOT NULL", () => {
    expect(lines.slice(2, 9)).toEqual([
      '  "full_name" text NOT NULL,',
      '  "notes" text,',
      '  "age" numeric NOT NULL,',
      '  "has_clay" boolean,',
      '  "start_date" date NOT NULL,',
      '  "email" text NOT NULL,',
      `  "level" text CHECK ("level" IN ('Beginner', 'Says "hi"'))`,
    ]);
  });

  it("escapes single quotes in enum options", () => {
    const quoted: Spec = { ...spec, fields: [{ key: "mood", label: "Mood", type: "enum", required: true, options: ["It's fine", "Bad"] }] };
    expect(toPostgresTable(quoted)).toContain(`IN ('It''s fine', 'Bad')`);
  });

  it("renames the primary key when a field is called id", () => {
    const withId: Spec = { ...spec, fields: [{ key: "id", label: "ID", type: "string", required: true }] };
    expect(toPostgresTable(withId).split("\n").slice(1, 3)).toEqual([
      '  "record_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),',
      '  "id" text NOT NULL',
    ]);
  });
});

describe("toSnakeCase", () => {
  it("splits on capital letters", () => {
    expect(toSnakeCase("fullName")).toBe("full_name");
    expect(toSnakeCase("PotteryClassWaitlist")).toBe("pottery_class_waitlist");
  });
});
