import type { Revision } from "./api";

type Props = {
  revisions: Revision[];
  isBusy: boolean;
  onRestore: (revisionId: string) => void;
};

const EXCERPT_LENGTH = 60;

export function RevisionHistory({ revisions, isBusy, onRestore }: Props) {
  if (revisions.length === 0) return <p className="muted">No revisions yet.</p>;

  return (
    <ol className="history">
      {revisions.map((rev, i) => (
        <li key={rev.id}>
          <div className="history-top">
            <strong>v{rev.version}</strong>
            <time dateTime={rev.createdAt}>{new Date(rev.createdAt).toLocaleString()}</time>
          </div>
          <p className="excerpt" title={rev.prompt}>
            {excerpt(rev.prompt)}
          </p>
          <p className="stats">{stats(rev, revisions)}</p>
          {/* The newest revision is already current, so restoring it would only make a copy. */}
          {i > 0 && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onRestore(rev.id)}
              aria-label={`Restore version ${rev.version}`}
            >
              Restore
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

function excerpt(prompt: string) {
  return prompt.length > EXCERPT_LENGTH ? `${prompt.slice(0, EXCERPT_LENGTH)}…` : prompt;
}

// Restores have no model call, so they show where they came from instead of usage numbers.
function stats(rev: Revision, all: Revision[]) {
  if (rev.restoredFrom) {
    const source = all.find((r) => r.id === rev.restoredFrom);
    return source ? `Restored from v${source.version}` : "Restored";
  }
  const seconds = ((rev.latencyMs ?? 0) / 1000).toFixed(1);
  const attempts = rev.attempts === 1 ? "1 attempt" : `${rev.attempts} attempts`;
  return `${attempts} · ${seconds} s · ${rev.inputTokens} in / ${rev.outputTokens} out tokens`;
}
