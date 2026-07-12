/**
 * Build provenance — which Timber source this editor bundle was built from (SPEC §12).
 *
 * Unlike the per-site {@link RepoConfig} (which a site supplies at *runtime* via
 * `config.js`), this describes **this specific build**, so it's baked in from
 * `VITE_*` build vars by `deploy.yml` at deploy time: the upstream Timber repo, the
 * ref it followed (`main` today), and the exact commit SHA that was checked out.
 *
 * The editor uses it to notice when the branch it follows has moved on — i.e. a newer
 * Timber is available — and offer a one-click redeploy (see `state/upstreamVersion`).
 * When any field is missing (a local/dev build with no CI vars) the check is simply
 * skipped: no provenance, no banner.
 */
export interface BuildInfo {
  /** The upstream Timber repo the editor was built from, e.g. `TimAidley/Timber`. */
  upstream: { owner: string; repo: string } | undefined;
  /** The ref of that repo the build followed — a branch (`main`) or a pinned tag. */
  ref: string | undefined;
  /** The exact commit SHA of `ref` at build time — the baseline for the drift check. */
  sha: string | undefined;
}

/** A subset of `import.meta.env` — just the keys we read (kept loose for testing). */
type EnvLike = Record<string, string | undefined>;

/** A non-empty string, else undefined — so a blank/absent CI var falls back cleanly. */
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Parse an `owner/repo` slug; undefined if it isn't exactly two non-empty segments. */
function parseRepo(
  slug: string | undefined,
): { owner: string; repo: string } | undefined {
  if (!slug) return undefined;
  const parts = slug.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return { owner: parts[0], repo: parts[1] };
}

/** Resolve the build provenance from the `VITE_*` build vars. Pure + injectable. */
export function resolveBuildInfo(env: EnvLike): BuildInfo {
  return {
    upstream: parseRepo(str(env.VITE_TIMBER_UPSTREAM_REPO)),
    ref: str(env.VITE_TIMBER_UPSTREAM_REF),
    sha: str(env.VITE_TIMBER_BUILD_SHA),
  };
}

/**
 * True only when we know enough to check for drift (upstream repo, ref, and the built
 * SHA are all present). A dev build without CI vars returns false, so the editor never
 * shows a spurious update banner.
 */
export function canCheckForUpdate(
  info: BuildInfo,
): info is { upstream: { owner: string; repo: string }; ref: string; sha: string } {
  return info.upstream !== undefined && info.ref !== undefined && info.sha !== undefined;
}

/** The provenance of this running bundle, resolved once at load. */
export const buildInfo: BuildInfo = resolveBuildInfo(
  import.meta.env as unknown as EnvLike,
);
