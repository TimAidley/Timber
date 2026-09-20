import type { FrontMatter } from '@timber/generator';

/** A draft recovery declined to restore, kept so the author can ask for it back. */
export interface SetAsideDraft {
  path: string;
  data: FrontMatter;
  body: string;
}

/** `content/posts/hello/index.md` → `hello`; anything else keeps its file name. */
function label(path: string): string {
  if (path.endsWith('/index.md'))
    return (
      path
        .replace(/\/index\.md$/, '')
        .split('/')
        .pop() ?? path
    );
  return path.split('/').pop() ?? path;
}

interface StaleDraftsBannerProps {
  /** Every set-aside path — content objects and advanced files alike. */
  paths: readonly string[];
  onRestore: () => void;
  onDiscard: () => void;
}

/**
 * "A local draft was set aside" (SPEC §5 base-SHA check, §11's draft layer).
 *
 * Shown when load-time recovery found drafts written against a version of a file the
 * branch has since moved past — another device, or a direct push. The branch copy wins
 * by default, which is the safe half: nothing the author can't see gets overwritten.
 * But the draft is not thrown away either, because it may hold real work, so the choice
 * is theirs and this is where it's offered.
 *
 * Deliberately not a merge UI — the same detect-don't-resolve posture as
 * {@link ForeignChangesBanner}, whose wording and shape this follows so the two read as
 * one idea. Either button settles it and deletes the draft, so it can't come back a
 * second time.
 */
export function StaleDraftsBanner({
  paths,
  onRestore,
  onDiscard,
}: StaleDraftsBannerProps): React.JSX.Element {
  const n = paths.length;
  return (
    <div className="foreign-banner foreign-banner--clash" role="status">
      <span className="foreign-banner__glyph" aria-hidden="true">
        ⚠
      </span>
      <span className="foreign-banner__text">
        {n === 1 ? 'A local draft of ' : `${n} local drafts — `}
        <strong>{paths.map(label).join(', ')}</strong>
        {n === 1 ? ' was' : ' — were'} written before {n === 1 ? 'it' : 'they'} changed
        elsewhere, so {n === 1 ? "it's" : "they're"} set aside and you're seeing the
        current version. Restoring would overwrite what changed.
      </span>
      <button type="button" className="foreign-banner__btn" onClick={onRestore}>
        Restore {n === 1 ? 'my draft' : 'my drafts'}
      </button>
      <button type="button" className="foreign-banner__btn" onClick={onDiscard}>
        Discard {n === 1 ? 'it' : 'them'}
      </button>
    </div>
  );
}
