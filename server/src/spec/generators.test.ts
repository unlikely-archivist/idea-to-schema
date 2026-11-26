import { describe, expect, it } from "vitest";
import type { Spec } from "./gate.js";
import { toJsonSchema, toPascalCase, toTypeScript } from "./generators.js";

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
