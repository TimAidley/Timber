import type { ChangeState } from './changes.js';

/**
 * Where an object's working copy is *allowed* to live — the SPEC §5/§8 **storage
 * axis**, device-local metadata (not front matter). `device` = kept in this browser
 * only (IndexedDB), deliberately held out of the WIP commit stream; `backed-up` =
 * committed to the per-user `<login>_wip` branch as usual (the default).
 *
 * This is orthogonal to **publication** (the `public` front-matter flag). Absence of
 * a stored level means `backed-up` — only objects the author has parked on-device
 * carry an explicit `device`.
 */
export type StorageLevel = 'device' | 'backed-up';

/** Backed-up is the default when no device-level metadata is recorded for an object. */
export const DEFAULT_STORAGE: StorageLevel = 'backed-up';

/**
 * State of one stop on an object's journey (SPEC §8 location readout):
 *
 *   💻 This device → ☁ Host → 🌐 Website
 *
 * The stop-state answers the two questions the readout exists for — *is there a copy
 * here* and *is it your latest* — as a **relationship**, never a synthetic revision
 * number:
 *   - `absent`  — no copy here (device-only never reaches the host; unpublished never reaches the site).
 *   - `behind`  — a copy exists but it's older than your live edits ("changes not uploaded here").
 *   - `current` — this stop has your latest.
 *   - `draft`   — website-only: publication is draft, so the build skips it ("won't appear").
 *   - `no-deploy` — website-only: the host offers no deploy backend, so there's no site to reach.
 */
export type StopState = 'absent' | 'behind' | 'current' | 'draft' | 'no-deploy';

export interface LocationReadout {
  /** The device holds your live edits, so it is always the freshest stop. */
  device: 'current';
  host: 'absent' | 'behind' | 'current';
  website: StopState;
}

/**
 * The signals needed to place one object on the pipeline. All are already computed in
 * the editor: `storage` from the device-metadata store; `hasLocalEdits` from the
 * autosaver's editing set; `differsFromMain`/`newToMain` from the `main…wip` diff; the
 * publication flag from front matter; `canDeploy` from whether the host exposes a
 * `DeployBackend` (SPEC §8 — the website stop degrades when it can't).
 */
export interface LocationInputs {
  storage: StorageLevel;
  /** Local-only edits not yet in the WIP commit (the autosaver's "editing" set). */
  hasLocalEdits: boolean;
  /** The object differs from `main` — i.e. it is committed to WIP ahead of the site. */
  differsFromMain: boolean;
  /** Added on WIP and never on `main` — lets the website read `absent` vs `behind`. */
  newToMain: boolean;
  /** Publication flag (SPEC §5). A draft never reaches the live site. */
  isPublic: boolean;
  /** Whether the host can deploy a site at all (has a `DeployBackend`). */
  canDeploy: boolean;
}

/**
 * Compute the three-stop readout for one object (pure; the heart of SPEC §8's location
 * surfacing). Kept free of React/host so it's unit-tested directly.
 *
 * Host stop: a **device-only** object is never committed, so the host has no copy
 * (`absent`); otherwise the host is `behind` while local edits sit uncommitted and
 * `current` once they've flushed to WIP.
 *
 * Website stop, in precedence order: no deploy backend ⇒ `no-deploy`; a draft ⇒
 * `draft` (skipped by the build whatever else is true); a device-only or
 * never-published object ⇒ `absent`; a public object with unpublished changes ⇒
 * `behind` (an older version is live); otherwise `current` (live and up to date).
 */
export function computeLocationReadout(input: LocationInputs): LocationReadout {
  const onDevice = input.storage === 'device';

  const host: LocationReadout['host'] = onDevice
    ? 'absent'
    : input.hasLocalEdits
      ? 'behind'
      : 'current';

  let website: StopState;
  if (!input.canDeploy) website = 'no-deploy';
  else if (!input.isPublic) website = 'draft';
  else if (onDevice || input.newToMain) website = 'absent';
  else if (input.hasLocalEdits || input.differsFromMain) website = 'behind';
  else website = 'current';

  return { device: 'current', host, website };
}

/**
 * Collapse the readout to the compact sidebar badge (SPEC §8): the **furthest stop
 * that holds your latest**, plus whether your device is ahead of it (uncommitted or
 * unpublished work downstream). `draft`/`no-deploy`/`absent` at the website don't
 * count as "reached the website"; a draft that is otherwise fully backed up still
 * reads as reached-the-host.
 */
export type ReachedStop = 'device' | 'host' | 'website';

export interface CompactStatus {
  /** The furthest stop that currently holds the latest content. */
  reached: ReachedStop;
  /** True when a downstream stop is behind — there's work not yet pushed onward. */
  ahead: boolean;
}

export function compactStatus(readout: LocationReadout): CompactStatus {
  if (readout.website === 'current') return { reached: 'website', ahead: false };
  if (readout.host === 'current') {
    // On the host and up to date; "ahead" iff the site is a stale/absent public copy.
    return { reached: 'host', ahead: readout.website === 'behind' };
  }
  // Not current on the host: the device is the only place with the latest.
  return { reached: 'device', ahead: readout.host === 'behind' || readout.host === 'absent' };
}

/**
 * Bridge to the legacy per-item {@link ChangeState} used by the current sidebar until
 * the readout UI lands (SPEC §8 "pending implementation"). A device-only object with
 * no host copy reads as `editing` (its newest bytes are local-only), matching how the
 * old model treats not-yet-committed work.
 */
export function changeStateFromReadout(
  readout: LocationReadout,
  fallback: ChangeState,
): ChangeState {
  if (readout.host === 'absent') return 'editing';
  return fallback;
}
