export interface StagedAsset {
  /** Repo-relative path the asset will be committed to (SPEC §4 colocated bundle). */
  path: string;
  blob: Blob;
  /** An object URL for previewing the staged bytes in-app. */
  url: string;
}

/**
 * Fetches the committed bytes for a repo path (e.g. from the WIP branch), so an image
 * inserted in a previous session can be re-shown after a reload. Returns `undefined`
 * when the path isn't committed (e.g. staged-but-never-flushed, or genuinely missing).
 */
export type AssetLoader = (path: string) => Promise<Blob | undefined>;

/**
 * In-memory staging area for processed image bytes (SPEC §7/§11). An image uploaded
 * this session lives here keyed by its bundle path; autosave drains it into the WIP
 * commit. On a later reload the bytes are back on the branch but NOT in memory, so an
 * optional {@link AssetLoader} lazily re-fetches a committed asset on demand — that's
 * what lets a `:::figure` (or `image` field) render again after a reload, before publish.
 */
export class AssetStore {
  private readonly assets = new Map<string, StagedAsset>();
  private readonly pending = new Map<string, Promise<string | undefined>>();

  constructor(private readonly loader?: AssetLoader) {}

  /** Stage (or replace) the bytes for a path, returning the staged asset. */
  stage(path: string, blob: Blob): StagedAsset {
    const previous = this.assets.get(path);
    if (previous) URL.revokeObjectURL(previous.url);
    const asset: StagedAsset = { path, blob, url: URL.createObjectURL(blob) };
    this.assets.set(path, asset);
    return asset;
  }

  urlFor(path: string): string | undefined {
    return this.assets.get(path)?.url;
  }

  /** The staged Blob for a path, for local persistence (device-only bundles, SPEC §5/§8). */
  blobFor(path: string): Blob | undefined {
    return this.assets.get(path)?.blob;
  }

  /**
   * Resolve a path to a displayable object URL, lazily fetching committed bytes via the
   * loader when they aren't already in memory. Concurrent calls for the same path share
   * one fetch. Returns `undefined` if nothing is staged and nothing can be loaded.
   */
  async ensure(path: string): Promise<string | undefined> {
    const existing = this.assets.get(path);
    if (existing) return existing.url;
    if (!this.loader) return undefined;

    let inFlight = this.pending.get(path);
    if (!inFlight) {
      inFlight = this.loader(path)
        .then((blob) => (blob ? this.stage(path, blob).url : undefined))
        .catch(() => undefined)
        .finally(() => this.pending.delete(path));
      this.pending.set(path, inFlight);
    }
    return inFlight;
  }

  /** Raw bytes for a staged asset, for committing to git (SPEC §7/§11). */
  async bytes(path: string): Promise<Uint8Array | undefined> {
    const asset = this.assets.get(path);
    if (!asset) return undefined;
    return new Uint8Array(await asset.blob.arrayBuffer());
  }

  all(): StagedAsset[] {
    return [...this.assets.values()];
  }
}
