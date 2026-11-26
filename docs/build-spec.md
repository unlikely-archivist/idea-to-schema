# idea-to-schema: build spec

Handoff for a Claude Code session building this with Eryn. Read all of it before writing code.

## What it is

A small web app. The user types a feature idea in plain English ("a sign-up form for a pottery class waitlist"). An AI model returns a structured field list. The server validates it, then generates three things from it in code: a JSON Schema, a TypeScript interface, and a live form preview. Every generation is saved as an immutable revision the user can browse and restore.

## Working rule: Eryn must be able to explain every line

Interviews will ask Eryn to defend this code. So:

- Build in the order below, one step at a time. After each step, explain in plain words what was built and why, and wait for Eryn to say go.
- Prefer boring, readable code over clever code. No abstractions for single-use code.
- Eryn writes the README's "Decisions" section in their own words. Draft notes for it if asked; don't write the final version.
- One branch and PR per step. Eryn reviews and merges. On the PRs for steps 4, 5, 6, and 10 (retry and idempotency, concurrency, the model adapter, deploy security), run the `typescript-reviewer` agent first and answer its comments in the PR. Skip it on the other steps.

## Scope

**In:**
- one page: prompt box, Generate button, result panel, revision history with restore
- API with the routes below
- Postgres in Docker, Drizzle ORM, migrations
- LLM tool calling with a fixed input schema; zod validation; one repair retry
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
- **AI:** Cloudflare Workers AI, called over its REST API with `fetch` (no SDK). See "Model choice" below.
- **Tests:** Vitest.
- **Layout:** one repo, two folders: `web/` and `server/`. No monorepo tooling.

Machine: 2019 Intel MacBook Pro, 16 GB RAM. Docker Desktop is fine. Keep it light.

## Model choice

The app must cost nothing to run, including when other people try the live demo. That rules out paid APIs such as Anthropic's or OpenAI's.

- **Provider:** Cloudflare Workers AI. The free allocation (10,000 Neurons a day, reset at 00:00 UTC) needs no card, and requests past it fail instead of billing.
- **Model:** a Workers AI model that is available on the Workers Free plan and supports function calling. Using `@cf/zai-org/glm-4.7-flash` (checked 2026-11-25). Free-plan models change, so re-check the catalog if requests start failing.
- **Known quirk:** Workers AI sometimes returns GLM's native tool-call text (`<tool_call>define_spec<arg_key>…</arg_key><arg_value>…</arg_value>`) in `arguments` instead of JSON. It's intermittent (seen 2026-11-25). The adapter reads that format too.
- **Not tied to the provider:** the model sits behind the `SpecGenerator` interface (see Tests), so switching providers means writing one new adapter. Nothing else changes.
- **Smaller model, same design:** a free model breaks the rules more often than a frontier one. The validation gate and repair retry exist for exactly that, so the design holds.

## Core design: the model writes data, code writes TypeScript

The model never writes TypeScript or JSON Schema directly. It returns a field list through a tool call. The server turns that list into the schema, the interface, and the form. Generated output can't contain broken code, and the validation gate has something precise to check.

### Tool the model must call: `define_spec`

```json
{
  "name": "define_spec",
  "parameters": {
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

Force the tool with `tool_choice`. GLM-4.7-Flash accepts it. If the model replies without calling `define_spec`, count that as a failed attempt.

### Validation gate (server, zod + plain checks)

Reject the output if any of these fail. Collect every error, not just the first.

- matches the shape above
- 1–20 fields
- each `key` is camelCase (`^[a-z][a-zA-Z0-9]*$`) and unique
- `type: "enum"` has 2–20 non-empty, unique `options`; other types have no `options`
- `title` and every `label` are non-empty and under 80 characters

### Repair retry

- Attempt 1 fails the gate → send the error list back to the model in the same conversation as the reply to its tool call, asking it to call `define_spec` again with fixes.
- Attempt 1 has no `define_spec` call → there is no tool call to reply to, so the retry sends a plain user message asking for one.
- Attempt 1's tool arguments aren't a JSON object (for example, bad JSON) → echoing them back as a tool call is an invalid message that Workers AI rejects with a 400, so the retry sends the error list as a plain user message.
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
- Generate requests carry an `Idempotency-Key` header, a UUID the client makes once per click. Before calling the model, look for an existing revision with that `(spec_id, idempotency_key)`. If one exists, return it with 200 and no model call. A unique constraint backs this up if two requests race.
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
- **Loading and errors:** disable the Generate button while generating, and the Restore buttons while a restore runs. Restore has no idempotency key, so this is what stops a double-click from saving two copies. Show 422 details as a readable list.
- **Error boundary:** wrap the preview, so a bad render shows a message instead of a blank page.
- **Accessibility:**
  - every input has a label
  - everything works from the keyboard
  - focus moves to the result heading after a generate
  - visible focus styles
  - color contrast at least 4.5:1
- **Copy buttons:** one each for the TypeScript and JSON Schema tabs.

## Secrets and config

- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (Workers AI permission only), `DATABASE_URL`, and `TEST_DATABASE_URL` go in `server/.env`. Commit `.env.example` and keep `.env` in `.gitignore`.
- Never log the API token or full prompts in CI output.

## Tests (Vitest, real Postgres)

The model call sits behind a small, provider-neutral interface (`generateSpec(messages) → { toolCallId, toolInput, usage, model }`), so tests swap in a fake. Integration tests run against the docker-compose Postgres locally and a service container in CI, with a separate test database (`TEST_DATABASE_URL`) that is created and migrated before the run and truncated between tests, so tests never wipe dev data.

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

No API token in CI; all tests use the fake.

## Build order (checkpoint after each)

1. Repo skeleton: `web/`, `server/`, docker-compose, `.env.example`, `.gitignore`. Postgres starts.
2. Drizzle schema and first migration. Confirm the tables in `psql`.
3. Zod gate + generators + unit tests (tests 1 and 6). No network yet.
4. Generate route with the fake generator, repair retry, idempotency (tests 2–4).
5. Restore and revisions list (test 5), then the concurrency test (test 7).
6. Real Workers AI adapter. One manual test with a real token. Record the tokens a typical generation uses. Result (one test, a 5-field form, passed on attempt 1): 371 input, 540 output, 8.8 s.
7. React page: prompt, result tabs, history, restore, error boundary.
8. CI workflow green on GitHub.
9. README: what it does, a screenshot, how to run (docker compose up, migrate, dev), Eryn's "Decisions" section, and "What I'd do next" (streaming, diff view, auth).
10. Deploy. First check current free hosting and free Postgres options on the web. Add the rate limit and daily cap before going live. Size the daily cap from step 6's token counts so it stays under the free Workers AI allocation.

If time runs short, stop after step 8. A tested backend with a plain UI beats a pretty, untested one.

## Done means

- **Fresh clone:** `docker compose up -d`, migrate, then dev. The app works with a real Cloudflare token.
- **Live:** the deployed site works, and the rate limit and daily cap hold.
- **Tests and CI:** all 7 test groups pass locally and in CI.
- **Explainable:** Eryn can answer each of these without notes:
  - Why does the model output data instead of code?
  - What happens if two Generate clicks race?
  - What happens if the model fails validation twice?
  - Why Workers AI, and what would switching providers take?
  - Why are revisions append-only?

