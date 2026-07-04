export interface StagedAsset {
  /** Repo-relative path the asset will be committed to (SPEC §4 colocated bundle). */
  path: string;
  blob: Blob;
  /** An object URL for previewing the staged bytes in-app. */
  url: string;
}

/**
 * In-memory staging area for processed image bytes. Slice 4b has no git yet, so an
 * uploaded+processed image lives here keyed by its eventual bundle path; Phase 5's
 * commit loop will drain this store into a real commit. Meanwhile it feeds the
 * widget thumbnail and the live preview (object URLs).
 */
export class AssetStore {
  private readonly assets = new Map<string, StagedAsset>();

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
