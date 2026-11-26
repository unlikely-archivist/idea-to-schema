# idea-to-schema: build spec

Handoff for a Claude Code session building this with Eryn. Read all of it before writing code.

## What it is

A small web app. The user types a feature idea in plain English ("a sign-up form for a pottery class waitlist"). Claude returns a structured field list. The server validates it, then generates three things from it in code: a JSON Schema, a TypeScript interface, and a live form preview. Every generation is saved as an immutable revision the user can browse and restore.

## Working rule: Eryn must be able to explain every line

Interviews will ask Eryn to defend this code. So:

- Build in the order below, one step at a time. After each step, explain in plain words what was built and why, and wait for Eryn to say go.
- Prefer boring, readable code over clever code. No abstractions for single-use code.
- Eryn writes the README's "Decisions" section in their own words. Draft notes for it if asked; don't write the final version.

## Scope

**In:**
- one page: prompt box, Generate button, result panel, revision history with restore
- API with the routes below
- Postgres in Docker, Drizzle ORM, migrations
- Claude tool calling with a fixed input schema; zod validation; one repair retry
- per-revision logging of tokens, latency, and attempts
- idempotent generate requests; restore creates a new revision
- integration tests against real Postgres; GitHub Actions CI
- README with screenshot
- one branch and pull request per build step, each with a what / why / how-tested description
- deployment to a free host with free Postgres, behind a per-IP rate limit and a daily generation cap

**Out:** streaming, auth, side-by-side diff view, running model-generated code, multiple users, editing fields by hand.

## Stack

Verify current stable versions when installing; don't pin from memory.

- **Frontend:** Vite + React + TypeScript. Plain CSS, no UI kit.
- **Server:** Node + Hono (`@hono/node-server`), TypeScript, run with `tsx` in dev.
- **Database:** PostgreSQL via `docker-compose.yml`, Drizzle ORM + drizzle-kit migrations.
- **Validation:** zod.
- **AI:** official Anthropic TypeScript SDK. Use the latest Claude Sonnet model; check the current model ID in Anthropic's docs.
- **Tests:** Vitest.
- **Layout:** one repo, two folders: `web/` and `server/`. No monorepo tooling.

Machine: 2019 Intel MacBook Pro, 16 GB RAM. Docker Desktop is fine. Keep it light.

## Core design: the model writes data, code writes TypeScript

Claude never writes TypeScript or JSON Schema directly. It returns a field list through a tool call. The server turns that list into the schema, the interface, and the form. Generated output can't contain broken code, and the validation gate has something precise to check.

### Tool the model must call: `define_spec`

```json
{
  "name": "define_spec",
  "input_schema": {
    "type": "object",
    "required": ["title", "summary", "fields"],
    "properties": {
      "title":   { "type": "string" },
      "summary": { "type": "string" },
      "fields": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["key", "label", "type", "required"],
          "properties": {
            "key":      { "type": "string" },
            "label":    { "type": "string" },
            "type":     { "enum": ["string", "text", "number", "boolean", "date", "email", "enum"] },
            "required": { "type": "boolean" },
            "options":  { "type": "array", "items": { "type": "string" } },
            "help":     { "type": "string" }
          }
        }
      }
    }
  }
}
```

Force the tool with `tool_choice: { type: "tool", name: "define_spec" }`.

### Validation gate (server, zod + plain checks)

Reject the output if any of these fail. Collect every error, not just the first.

- matches the shape above
- 1–20 fields
- each `key` is camelCase (`^[a-z][a-zA-Z0-9]*$`) and unique
- `type: "enum"` has 2–20 non-empty, unique `options`; other types have no `options`
- `title` and every `label` are non-empty and under 80 characters

### Repair retry

- Attempt 1 fails the gate → send the error list back to Claude in the same conversation as a `tool_result` with `is_error: true`, asking it to call `define_spec` again with fixes.
- Attempt 2 fails → stop. Return 422 with the errors. Save nothing.
- Max 2 attempts total. The cap is a constant, and a test proves it holds.

### Generators (pure functions, unit tested)

- `toJsonSchema(spec)`: draft 2020-12 object schema. `email` → `format: "email"`, `date` → `format: "date"`, `enum` → `enum: [...]`, `text` → string.
- `toTypeScript(spec)`: an `interface` named from the title in PascalCase. Optional fields get `?`. Enums become string-literal unions.
- The form preview in React renders from the spec, not from generated code.

## Data model (Postgres, Drizzle)

**specs**
- `id` uuid primary key
- `created_at` timestamptz default now

**revisions** (append-only, never updated)
- `id` uuid primary key
- `spec_id` uuid → specs.id
- `version` integer. Unique together with `spec_id`.
- `prompt` text. The user's words; for a restore, the restored revision's prompt.
- `spec_json` jsonb. The validated field list.
- `restored_from` uuid, nullable → revisions.id
- `idempotency_key` text, nullable. Unique together with `spec_id`.
- `attempts` integer. 1 or 2; 0 for a restore.
- `input_tokens`, `output_tokens` integer, nullable for restores
- `latency_ms` integer, nullable for restores
- `model` text, nullable for restores
- `created_at` timestamptz default now

### Concurrency and idempotency rules

- New revision: in one transaction, read `max(version)` for the spec and insert `max + 1`. If the unique `(spec_id, version)` constraint fires, return 409 so the client can refresh. Don't retry silently.
- Generate requests carry an `Idempotency-Key` header, a UUID the client makes once per click. Before calling Claude, look for an existing revision with that `(spec_id, idempotency_key)`. If one exists, return it with 200 and no model call. A unique constraint backs this up if two requests race.
- Restore never edits old rows. It inserts a new revision copying `spec_json`, with `restored_from` set.

## API

All JSON. Errors are `{ "error": string, "details"?: string[] }`.

| Method | Path | Body / headers | Success |
|---|---|---|---|
| POST | `/api/specs` | none | 201 `{ id }` |
| POST | `/api/specs/:id/generate` | `{ prompt }`, header `Idempotency-Key` | 201 new revision; 200 on idempotent replay |
| GET | `/api/specs/:id/revisions` | none | 200 revisions, newest first |
| POST | `/api/specs/:id/revisions/:revId/restore` | none | 201 new revision |

- **Prompt:** 1–2,000 characters, otherwise 400.
- **Unknown spec or revision:** 404.
- **Missing Idempotency-Key:** 400.
- **Gate failed twice:** 422 with `details`.
- **Every revision response** includes `jsonSchema` and `typescript`, generated from `spec_json` on read. Don't store them.

## Frontend

- **Layout:** one page.
  - Top: prompt textarea and Generate button.
  - Left: the result, in tabs for Form preview, TypeScript, and JSON Schema.
  - Right: revision history (version, time, attempts, latency, input/output tokens, a short prompt excerpt, Restore button).
- **State:** plain React state plus one small `api.ts` module. No state library.
- **Loading and errors:** disable the button while generating. Show 422 details as a readable list.
- **Error boundary:** wrap the preview, so a bad render shows a message instead of a blank page.
- **Accessibility:**
  - every input has a label
  - everything works from the keyboard
  - focus moves to the result heading after a generate
  - visible focus styles
  - color contrast at least 4.5:1
- **Copy buttons:** one each for the TypeScript and JSON Schema tabs.

## Secrets and config

- `ANTHROPIC_API_KEY` and `DATABASE_URL` go in `server/.env`. Commit `.env.example` and keep `.env` in `.gitignore`.
- Never log the API key or full prompts in CI output.

## Tests (Vitest, real Postgres)

The Claude call sits behind a small interface (`generateSpec(messages) → { toolInput, usage }`), so tests swap in a fake. Integration tests run against the docker-compose Postgres locally and a service container in CI, with a migrated database that gets truncated between tests.

Must-have tests:

1. **Gate:**
   - valid spec passes
   - duplicate keys, a bad key, an enum without options, and options on a non-enum each fail with clear messages
   - multiple errors are all reported
2. **Repair retry:**
   - the fake returns invalid then valid → 201, `attempts = 2`, and the second call received the error list
3. **Retry cap:**
   - the fake returns invalid twice → 422, the fake was called exactly 2 times, and no row was saved
4. **Idempotency:**
   - the same key twice → one row and one model call; the second response is 200 with the same id
5. **Restore:**
   - creates version n+1 with `restored_from` set
   - the old row is unchanged
6. **Generators:**
   - snapshot-free assertions on `toTypeScript` and `toJsonSchema` for each field type
7. **Concurrency:**
   - two simultaneous inserts for the same spec end with versions 1 and 2, or one 409; never a duplicate version

## CI

`.github/workflows/test.yml`. Runs on every push and pull request:

1. Start a `postgres` service container.
2. Install.
3. Run migrations.
4. Type-check both packages (`tsc --noEmit`).
5. Run Vitest.

No API key in CI; all tests use the fake.

## Build order (checkpoint after each)

1. Repo skeleton: `web/`, `server/`, docker-compose, `.env.example`, `.gitignore`. Postgres starts.
2. Drizzle schema and first migration. Confirm the tables in `psql`.
3. Zod gate + generators + unit tests (tests 1 and 6). No network yet.
4. Generate route with the fake generator, repair retry, idempotency (tests 2–4).
5. Restore and revisions list (test 5), then the concurrency test (test 7).
6. Real Claude adapter. One manual test with a real key.
7. React page: prompt, result tabs, history, restore, error boundary.
8. CI workflow green on GitHub.
9. README: what it does, a screenshot, how to run (docker compose up, migrate, dev), Eryn's "Decisions" section, and "What I'd do next" (streaming, diff view, auth).
10. Deploy. First check current free hosting and free Postgres options on the web. Add the rate limit and daily cap before going live.

If time runs short, stop after step 8. A tested backend with a plain UI beats a pretty, untested one.

## Done means

- **Fresh clone:** `docker compose up -d`, migrate, then dev. The app works with a real key.
- **Live:** the deployed site works, and the rate limit and daily cap hold.
- **Tests and CI:** all 7 test groups pass locally and in CI.
- **Explainable:** Eryn can answer each of these without notes:
  - Why does the model output data instead of code?
  - What happens if two Generate clicks race?
  - What happens if Claude fails validation twice?
  - Why are revisions append-only?

