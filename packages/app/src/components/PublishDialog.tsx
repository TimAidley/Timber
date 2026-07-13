import { useEffect, useState } from 'react';
import {
  planPublish,
  runPublish,
  describePublish,
  type PublishClient,
  type PublishContext,
  type PublishPlan,
} from '../state/publish.js';
import { PathDiff } from '../diff/PathDiff.js';
import type { RefTextClient } from '../diff/useRefText.js';

interface PublishDialogProps {
  /** RepoClient satisfies both structurally (planning + per-file diffs). */
  client: PublishClient & RefTextClient;
  ctx: PublishContext;
  onClose: () => void;
  /** Called with the new default-branch SHA after a successful publish. */
  onPublished: (sha: string) => void;
}

/**
 * The Publish / "Update site" dialog (SPEC §11): review the WIP↔main diff, edit the
 * commit message, and squash-merge to main. Blocks (with a clear reason) when there's
 * nothing to publish, a public object is invalid (SPEC §5 validity gate), or the same
 * file diverged on main since you started (detect-don't-resolve).
 */
export function PublishDialog({ client, ctx, onClose, onPublished }: PublishDialogProps): React.JSX.Element {
  const [plan, setPlan] = useState<PublishPlan | null>(null);
  const [message, setMessage] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishedSha, setPublishedSha] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which changed paths are expanded to show their diff.
  const [openDiffs, setOpenDiffs] = useState<ReadonlySet<string>>(new Set());
  const toggleDiff = (path: string): void =>
    setOpenDiffs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  useEffect(() => {
    // Plan once; don't re-plan after a successful publish (baseSha changes then,
    // which would otherwise re-fire this effect for a dialog that's already done).
    if (publishedSha) return;
    let cancelled = false;
    planPublish(client, ctx)
      .then((p) => {
        if (cancelled) return;
        setPlan(p);
        if (p.ok) setMessage(describePublish(p.changed));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [client, ctx, publishedSha]);

  async function doPublish(): Promise<void> {
    if (!plan?.ok) return;
    setPublishing(true);
    setError(null);
    try {
      const { sha } = await runPublish(client, ctx, plan, message);
      setPublishedSha(sha);
      onPublished(sha);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-label="Publish">
      <div className="modal__panel">
        <header className="modal__header">
          <h2>Publish to the live site</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {publishedSha ? (
          <div className="publish__done">
            <p>
              ✓ Published. <code>{ctx.defaultBranch}</code> is now at <code>{publishedSha.slice(0, 7)}</code>.
            </p>
            <button type="button" onClick={onClose}>
              Done
            </button>
          </div>
        ) : error ? (
          <p className="publish__error">{error}</p>
        ) : !plan ? (
          <p>Checking for changes…</p>
        ) : !plan.ok ? (
          <Block block={plan.block} onClose={onClose} />
        ) : (
          <>
            <p className="publish__summary">
              {plan.changed.length} change{plan.changed.length === 1 ? '' : 's'}
              {plan.strategy === 'rebase' ? ' · will rebase onto the latest main' : ''}
            </p>
            <ul className="publish__diff">
              {plan.changed.map((c) => {
                const open = openDiffs.has(c.path);
                const isText = !/\.(png|jpe?g|gif|webp|svg|avif|ico|woff2?|ttf|otf)$/i.test(c.path);
                return (
                  <li key={c.path} className="publish__diff-item">
                    <button
                      type="button"
                      className="publish__diff-toggle"
                      aria-expanded={open}
                      onClick={() => toggleDiff(c.path)}
                      title={isText ? (open ? 'Hide diff' : 'Show diff') : 'Binary asset'}
                    >
                      <span className={`publish__status publish__status--${c.status}`}>{c.status}</span>
                      <span className="publish__diff-path">{c.path}</span>
                      {isText ? (
                        <span className="publish__diff-chevron" aria-hidden="true">
                          {open ? '▾' : '▸'}
                        </span>
                      ) : null}
                    </button>
                    {open && isText ? (
                      <div className="publish__diff-body">
                        <PathDiff
                          client={client}
                          path={c.path}
                          baseRef={ctx.defaultBranch}
                          headRef={ctx.wipBranch}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <label className="publish__message">
              Commit message
              <input value={message} onChange={(e) => setMessage(e.target.value)} />
            </label>
            <div className="modal__actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="is-primary" disabled={publishing || !message.trim()} onClick={doPublish}>
                {publishing ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Block({ block, onClose }: { block: Extract<PublishPlan, { ok: false }>['block']; onClose: () => void }): React.JSX.Element {
  return (
    <div className="publish__block">
      {block.kind === 'nothing' ? (
        <p>Nothing to publish — the WIP branch matches the live site.</p>
      ) : block.kind === 'invalid' ? (
        <>
          <p>Can’t publish: these public items don’t validate yet. Fix or unpublish them first.</p>
          <ul>
            {block.objects.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p>
            The live site moved on since you started, and the same file changed on both sides. Reload to get
            the latest before publishing.
          </p>
          <ul>
            {block.paths.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </>
      )}
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
