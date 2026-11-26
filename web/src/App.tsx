import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, createSpec, generate, listRevisions, restore, type Revision } from "./api";
import { ResultTabs } from "./result-tabs";
import { RevisionHistory } from "./revision-history";

const SPEC_ID_KEY = "idea-to-schema:spec-id";
const MAX_PROMPT_LENGTH = 2000;

type ErrorState = { message: string; details: string[] };

export default function App() {
  const [specId, setSpecId] = useState(() => localStorage.getItem(SPEC_ID_KEY));
  const [prompt, setPrompt] = useState("");
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [busy, setBusy] = useState<"generating" | "restoring" | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const shouldFocusResult = useRef(false);

  // Load the history of the spec saved in this browser, if there is one.
  useEffect(() => {
    if (!specId) return;
    let ignore = false;
    listRevisions(specId)
      .then((rows) => {
        if (!ignore) setRevisions(rows);
      })
      .catch((err) => {
        if (ignore) return;
        // The saved spec is gone (for example, the database was reset). Start fresh.
        if (err instanceof ApiError && err.status === 404) {
          localStorage.removeItem(SPEC_ID_KEY);
          setSpecId(null);
        } else {
          setError(toErrorState(err));
        }
      });
    return () => {
      ignore = true;
    };
  }, [specId]);

  // Focus moves after React has drawn the new result, so this runs after render.
  useEffect(() => {
    if (shouldFocusResult.current) {
      shouldFocusResult.current = false;
      resultHeadingRef.current?.focus();
    }
  }, [revisions]);

  // The spec is created on the first Generate, not on page load, so visits
  // that never generate leave nothing behind.
  async function ensureSpecId() {
    if (specId) return specId;
    const { id } = await createSpec();
    localStorage.setItem(SPEC_ID_KEY, id);
    setSpecId(id);
    return id;
  }

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    setBusy("generating");
    setError(null);
    try {
      const id = await ensureSpecId();
      // One key per click: if this request is resent, the server returns the saved revision.
      const revision = await generate(id, prompt.trim(), crypto.randomUUID());
      shouldFocusResult.current = true;
      // An idempotent replay returns a revision already in the list.
      setRevisions((prev) => [revision, ...prev.filter((r) => r.id !== revision.id)]);
    } catch (err) {
      await handleActionError(err);
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore(revisionId: string) {
    if (!specId) return;
    setBusy("restoring");
    setError(null);
    try {
      const revision = await restore(specId, revisionId);
      setRevisions((prev) => [revision, ...prev]);
    } catch (err) {
      await handleActionError(err);
    } finally {
      setBusy(null);
    }
  }

  async function handleActionError(err: unknown) {
    setError(toErrorState(err));
    // 409 means another revision was saved at the same time; reload so the list is current.
    if (err instanceof ApiError && err.status === 409 && specId) {
      setRevisions(await listRevisions(specId));
    }
  }

  const current = revisions[0];
  const trimmedLength = prompt.trim().length;

  return (
    <main>
      <header>
        <h1>idea-to-schema</h1>
        <p className="muted">Describe a form in plain English. Get a live form preview, a TypeScript interface, a Zod validator, a JSON Schema, and a Postgres table.</p>
      </header>

      <form className="prompt" onSubmit={handleGenerate}>
        <label htmlFor="prompt">Feature idea</label>
        <textarea
          id="prompt"
          rows={3}
          maxLength={MAX_PROMPT_LENGTH}
          placeholder="A sign-up form for a pottery class waitlist"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          aria-describedby="prompt-count"
        />
        <div className="prompt-actions">
          <span id="prompt-count" className="muted">
            {prompt.length} / {MAX_PROMPT_LENGTH}
          </span>
          <button type="submit" className="primary" disabled={busy !== null || trimmedLength === 0}>
            {busy === "generating" ? "Generating…" : "Generate"}
          </button>
        </div>
      </form>

      {error && (
        <div className="error" role="alert">
          <p>{error.message}</p>
          {error.details.length > 0 && (
            <ul>
              {error.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="columns">
        <section className="result" aria-labelledby="result-heading">
          <h2 id="result-heading" ref={resultHeadingRef} tabIndex={-1}>
            {current ? current.specJson.title : "Result"}
          </h2>
          {current ? (
            <ResultTabs revision={current} />
          ) : (
            <p className="muted">Your generated form will appear here.</p>
          )}
        </section>

        <section className="history-panel" aria-labelledby="history-heading">
          <h2 id="history-heading">History</h2>
          <RevisionHistory revisions={revisions} isBusy={busy !== null} onRestore={handleRestore} />
        </section>
      </div>
    </main>
  );
}

function toErrorState(err: unknown): ErrorState {
  if (err instanceof ApiError) return { message: err.message, details: err.details };
  return { message: "Couldn't reach the server. Is it running?", details: [] };
}
