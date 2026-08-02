import { useEffect, useRef, useState } from 'react';
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
import { diagnostics } from '../state/diagnostics.js';
import { summarizeHostError } from '@timber/host';

interface PublishDialogProps {
  /** A HostProvider satisfies both structurally (planning + per-file diffs). */
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
  // Bumped to re-plan when the branch moved under us (see doPublish); the notice that
  // goes with it, so the refreshed list doesn't change silently under the reader.
  const [planSeq, setPlanSeq] = useState(0);
  const [restaleNotice, setRestaleNotice] = useState(false);
  // Whether the author has typed their own commit message — a re-plan refreshes the
  // generated default but must not overwrite what they wrote. A ref, not state: it's
  // read by the planning effect, and re-planning on every keystroke would be absurd.
  const messageEdited = useRef(false);
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
        if (p.ok && !messageEdited.current) setMessage(describePublish(p.changed));
      })
      .catch((e: unknown) => {
        // Say what failed and what fixes it; the raw host message goes to the log.
        const info = diagnostics.error('publish', 'could not plan the publish', e);
        if (!cancelled) setError(`${summarizeHostError(info)} — ${info.hint}`);
      });
    return () => {
      cancelled = true;
    };
  }, [client, ctx, publishedSha, planSeq]);

  /**
   * Publish the reviewed plan. `runPublish` refuses a plan whose branch has moved on
   * (a debounced autosave landing, another tab) rather than publishing a tree behind
   * the one shown here — so re-plan and let the author look at the newer state.
   */
  async function doPublish(): Promise<void> {
    if (!plan?.ok) return;
    setPublishing(true);
    setError(null);
    try {
      const outcome = await runPublish(client, ctx, plan, message);
      if (!outcome.ok) {
        setRestaleNotice(true);
        setPlan(null);
        setPlanSeq((n) => n + 1);
        return;
      }
      const { sha } = outcome;
      setPublishedSha(sha);
      onPublished(sha);
    } catch (e) {
      const info = diagnostics.error('publish', 'squash-merge to the default branch failed', e);
      setError(`${summarizeHostError(info)} — ${info.hint}`);
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
            {restaleNotice ? (
              <p className="publish__notice" role="status">
                More changes reached your branch while this was open — the list below is
                up to date. Publish to include them.
              </p>
            ) : null}
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
              <input
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  messageEdited.current = true;
                }}
              />
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
