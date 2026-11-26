import { useRef, useState, type KeyboardEvent } from "react";
import type { Revision } from "./api";
import { ErrorBoundary } from "./error-boundary";
import { FormPreview } from "./form-preview";

const TABS = [
  { id: "form", label: "Form preview" },
  { id: "typescript", label: "TypeScript" },
  { id: "schema", label: "JSON Schema" },
  { id: "zod", label: "Zod" },
  { id: "sql", label: "SQL" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// Follows the WAI-ARIA tabs pattern: Tab moves into the tab list once,
// arrow keys move between tabs, Home and End jump to the ends.
export function ResultTabs({ revision }: { revision: Revision }) {
  const [active, setActive] = useState<TabId>("form");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(e: KeyboardEvent) {
    const current = TABS.findIndex((t) => t.id === active);
    let next = current;
    if (e.key === "ArrowRight") next = (current + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    setActive(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  const schemaText = JSON.stringify(revision.jsonSchema, null, 2);

  return (
    <div className="tabs">
      <div role="tablist" aria-label="Result format" onKeyDown={handleKeyDown}>
        {TABS.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} tabIndex={0}>
        {active === "form" && (
          // A new key per revision clears an earlier render error.
          <ErrorBoundary key={revision.id}>
            <FormPreview spec={revision.specJson} revisionId={revision.id} />
          </ErrorBoundary>
        )}
        {active === "typescript" && <CodeBlock code={revision.typescript} label="TypeScript" />}
        {active === "schema" && <CodeBlock code={schemaText} label="JSON Schema" />}
        {active === "zod" && <CodeBlock code={revision.zod} label="Zod" />}
        {active === "sql" && <CodeBlock code={revision.sql} label="SQL" />}
      </div>
    </div>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="code-block">
      <button type="button" className="copy" onClick={handleCopy}>
        {copied ? "Copied" : `Copy ${label}`}
      </button>
      {/* Announces the copy to screen readers without moving focus. */}
      <span className="visually-hidden" aria-live="polite">
        {copied ? `${label} copied to clipboard` : ""}
      </span>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
