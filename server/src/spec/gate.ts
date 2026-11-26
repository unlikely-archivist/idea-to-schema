import { z } from "zod";

// The shape of the define_spec tool input. Zod checks types only;
// the rules below check everything else so each rule reads as plain code.
const FieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["string", "text", "number", "boolean", "date", "email", "enum"]),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  help: z.string().optional(),
});

const SpecSchema = z.object({
  title: z.string(),
  summary: z.string(),
  fields: z.array(FieldSchema),
});

export type Spec = z.infer<typeof SpecSchema>;
export type Field = z.infer<typeof FieldSchema>;

export type GateResult = { ok: true; spec: Spec } | { ok: false; errors: string[] };

const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
const MAX_TEXT_LENGTH = 80;

export function checkSpec(input: unknown): GateResult {
  const parsed = SpecSchema.safeParse(input);
  if (!parsed.success) {
    // The rule checks below assume the shape is right, so stop here.
    const errors = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
    );
    return { ok: false, errors };
  }

  const spec = parsed.data;
  const errors: string[] = [];

  errors.push(...checkText("title", spec.title));

  if (spec.fields.length < 1 || spec.fields.length > 20) {
    errors.push(`fields: must have 1 to 20 fields, got ${spec.fields.length}`);
  }

  const seenKeys = new Set<string>();
  spec.fields.forEach((field, i) => {
    const where = `fields[${i}]`;

    if (!KEY_PATTERN.test(field.key)) {
      errors.push(`${where}.key: "${field.key}" must be camelCase (start with a lowercase letter, letters and digits only)`);
    }
    if (seenKeys.has(field.key)) {
      errors.push(`${where}.key: "${field.key}" is used by more than one field`);
    }
    seenKeys.add(field.key);

    errors.push(...checkText(`${where}.label`, field.label));
    errors.push(...checkOptions(where, field));
  });

  return errors.length === 0 ? { ok: true, spec } : { ok: false, errors };
}

function checkText(where: string, value: string): string[] {
  if (value.trim() === "") return [`${where}: must not be empty`];
  if (value.length >= MAX_TEXT_LENGTH) {
    return [`${where}: must be under ${MAX_TEXT_LENGTH} characters, got ${value.length}`];
  }
  return [];
}

function checkOptions(where: string, field: Field): string[] {
  if (field.type !== "enum") {
    return field.options === undefined
      ? []
      : [`${where}.options: only enum fields can have options, but type is "${field.type}"`];
  }

  const options = field.options ?? [];
  const errors: string[] = [];
  if (options.length < 2 || options.length > 20) {
    errors.push(`${where}.options: enum fields need 2 to 20 options, got ${options.length}`);
  }
  if (options.some((option) => option.trim() === "")) {
    errors.push(`${where}.options: options must not be empty`);
  }
  if (new Set(options).size !== options.length) {
    errors.push(`${where}.options: options must be unique`);
  }
  return errors;
}
