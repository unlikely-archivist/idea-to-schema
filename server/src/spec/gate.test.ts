import { describe, expect, it } from "vitest";
import { checkSpec } from "./gate.js";

const validSpec = {
  title: "Pottery class waitlist",
  summary: "Collects sign-ups for a full pottery class.",
  fields: [
    { key: "fullName", label: "Full name", type: "string", required: true },
    { key: "email", label: "Email", type: "email", required: true },
    {
      key: "experience",
      label: "Experience level",
      type: "enum",
      required: false,
      options: ["Beginner", "Intermediate", "Advanced"],
    },
  ],
};

// Returns validSpec with fields replaced.
function withFields(fields: object[]) {
  return { ...validSpec, fields };
}

function errorsFor(input: unknown): string[] {
  const result = checkSpec(input);
  if (result.ok) throw new Error("expected the gate to fail, but it passed");
  return result.errors;
}

describe("checkSpec", () => {
  it("passes a valid spec", () => {
    expect(checkSpec(validSpec)).toEqual({ ok: true, spec: validSpec });
  });

  it("rejects duplicate keys", () => {
    const errors = errorsFor(
      withFields([
        { key: "email", label: "Email", type: "email", required: true },
        { key: "email", label: "Backup email", type: "email", required: false },
      ]),
    );
    expect(errors).toEqual(['fields[1].key: "email" is used by more than one field']);
  });

  it("rejects a key that isn't camelCase", () => {
    const errors = errorsFor(
      withFields([{ key: "Full_Name", label: "Full name", type: "string", required: true }]),
    );
    expect(errors).toEqual([
      'fields[0].key: "Full_Name" must be camelCase (start with a lowercase letter, letters and digits only)',
    ]);
  });

  it("rejects an enum without options", () => {
    const errors = errorsFor(
      withFields([{ key: "level", label: "Level", type: "enum", required: true }]),
    );
    expect(errors).toEqual(["fields[0].options: enum fields need 2 to 20 options, got 0"]);
  });

  it("rejects enum options that are empty or repeated", () => {
    const errors = errorsFor(
      withFields([
        { key: "level", label: "Level", type: "enum", required: true, options: ["A", "A", " "] },
      ]),
    );
    expect(errors).toEqual([
      "fields[0].options: options must not be empty",
      "fields[0].options: options must be unique",
    ]);
  });

  it("rejects options on a non-enum field", () => {
    const errors = errorsFor(
      withFields([{ key: "age", label: "Age", type: "number", required: true, options: ["1", "2"] }]),
    );
    expect(errors).toEqual([
      'fields[0].options: only enum fields can have options, but type is "number"',
    ]);
  });

  it("rejects zero fields and more than 20 fields", () => {
    expect(errorsFor(withFields([]))).toEqual(["fields: must have 1 to 20 fields, got 0"]);

    const tooMany = Array.from({ length: 21 }, (_, i) => ({
      key: `field${i}`,
      label: `Field ${i}`,
      type: "string",
      required: false,
    }));
    expect(errorsFor(withFields(tooMany))).toEqual(["fields: must have 1 to 20 fields, got 21"]);
  });

  it("rejects an empty title and a label of 80 characters or more", () => {
    const errors = errorsFor({
      ...validSpec,
      title: "  ",
      fields: [{ key: "name", label: "x".repeat(80), type: "string", required: true }],
    });
    expect(errors).toEqual([
      "title: must not be empty",
      "fields[0].label: must be under 80 characters, got 80",
    ]);
  });

  it("reports every error, not just the first", () => {
    const errors = errorsFor({
      ...validSpec,
      title: "",
      fields: [
        { key: "Bad Key", label: "One", type: "string", required: true },
        { key: "level", label: "", type: "enum", required: true },
        { key: "age", label: "Age", type: "number", required: true, options: ["1"] },
      ],
    });
    expect(errors).toHaveLength(5);
  });

  it("rejects the wrong shape with the path of each problem", () => {
    const errors = errorsFor({
      title: "Waitlist",
      fields: [{ key: "name", label: "Name", type: "url", required: "yes" }],
    });
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/^summary: /);
    expect(errors[1]).toMatch(/^fields\.0\.type: /);
    expect(errors[2]).toMatch(/^fields\.0\.required: /);
  });
});
