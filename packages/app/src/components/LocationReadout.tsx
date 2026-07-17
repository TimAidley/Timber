import type { RepoVisibility } from '@timber/host';
import type { LocationReadout as Readout, StopState } from '../state/location.js';

/**
 * The per-page **location readout** (SPEC §8): the object's journey across
 * 💻 This device · ☁ Host · 🌐 Website, each stop labelled with a plain-language
 * relationship (up to date / changes not uploaded / older version / not here) rather
 * than a revision number. The host stop also carries the repo-visibility wording so
 * "backed up" never quietly over-promises privacy.
 */

/** Repo-visibility wording for the host stop (SPEC §5 — read from getVisibility()). */
function exposure(visibility: RepoVisibility): string {
  if (visibility === 'public') return 'visible to anyone';
  if (visibility === 'private') return 'visible to collaborators';
  return 'visible to anyone who can read the repo';
}

interface StopMeta {
  /** Colour/status bucket: good = has your latest; warn = stale/absent; off = n/a. */
  tone: 'good' | 'warn' | 'off';
  text: string;
}

function hostMeta(state: Readout['host'], visibility: RepoVisibility): StopMeta {
  if (state === 'absent') return { tone: 'off', text: 'not backed up' };
  if (state === 'behind') return { tone: 'warn', text: 'changes not uploaded' };
  return { tone: 'good', text: `up to date · ${exposure(visibility)}` };
}

function websiteMeta(state: StopState): StopMeta {
  switch (state) {
    case 'no-deploy':
      return { tone: 'off', text: 'no site published from this host' };
    case 'draft':
      return { tone: 'off', text: "draft — won't appear" };
    case 'absent':
      return { tone: 'warn', text: 'not on the site yet' };
    case 'behind':
      return { tone: 'warn', text: 'older version live' };
    default:
      return { tone: 'good', text: 'live & up to date' };
  }
}

function Stop({ glyph, name, meta }: { glyph: string; name: string; meta: StopMeta }): React.JSX.Element {
  return (
    <li className={`readout__stop readout__stop--${meta.tone}`}>
      <span className="readout__glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="readout__stop-body">
        <span className="readout__stop-name">{name}</span>
        <span className="readout__stop-state">{meta.text}</span>
      </span>
    </li>
  );
}

export function LocationReadout({
  readout,
  visibility,
}: {
  readout: Readout;
  visibility: RepoVisibility;
}): React.JSX.Element {
  return (
    <ul className="readout" aria-label="Where this page is">
      <Stop glyph="💻" name="This device" meta={{ tone: 'good', text: 'your latest edits' }} />
      <Stop glyph="☁" name="Host" meta={hostMeta(readout.host, visibility)} />
      <Stop glyph="🌐" name="Website" meta={websiteMeta(readout.website)} />
    </ul>
  );
}
