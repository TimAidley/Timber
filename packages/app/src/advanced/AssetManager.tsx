import { useEffect, useRef, useState } from 'react';
import { processImage } from '../media/processImage.js';
import { classifyUpload, extensionOf } from '../media/assetPolicy.js';
import { extForMime, siteAssetPath } from '../media/assetName.js';
import { categorize, isThumbnailable, type SiteAsset } from '../media/siteAssets.js';
import { findAssetReferences, type SourceText } from '../media/assetReferences.js';
import { LEGACY_THEME, type ThemePaths } from '@timber/content';
import type { AssetStore } from '../state/assets.js';

interface AssetManagerProps {
  /** The committed theme-asset files at load, seeded from the session tree. */
  initialAssets: SiteAsset[];
  assetStore: AssetStore;
  /** Templates + stylesheets, scanned to warn before deleting a referenced asset. */
  sources: SourceText[];
  /** The active theme (SPEC §13): uploads land in its asset dir; refs resolve against it. */
  theme?: ThemePaths;
  /** Stage an uploaded asset's path for the WIP commit (autosave.markAssetDirty). */
  onStage: (path: string) => void;
  /** Delete asset paths from the branch (autosave.markPathsDeleted). */
  onDelete: (paths: string[]) => void;
}

const CATEGORY_LABEL: Record<SiteAsset['category'], string> = {
  image: 'Image',
  icon: 'Icon',
  font: 'Font',
  document: 'Document',
  style: 'Stylesheet',
  other: 'File',
};

function formatBytes(n: number | undefined): string {
  if (n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Upsert an asset into the list by path (a re-upload replaces in place), keeping it sorted. */
function upsert(list: SiteAsset[], asset: SiteAsset): SiteAsset[] {
  const without = list.filter((a) => a.path !== asset.path);
  return [...without, asset].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The site-asset manager (SPEC §13): browse, upload, and delete the shared files under
 * `/assets` — fonts, logos, favicons — that the theme references. Uploads run the curated
 * allowlist ({@link classifyUpload}): images through the in-browser pipeline, known binaries
 * passed through, everything else refused. Deleting an asset that a template or stylesheet
 * still references asks for confirmation, naming where it's used, so a delete never silently
 * breaks the build. Bytes are staged in the shared {@link AssetStore}; autosave commits them.
 */
export function AssetManager({
  initialAssets,
  assetStore,
  sources,
  theme = LEGACY_THEME,
  onStage,
  onDelete,
}: AssetManagerProps): React.JSX.Element {
  const [assets, setAssets] = useState<SiteAsset[]>(initialAssets);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ asset: SiteAsset; refs: string[] } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      const decision = classifyUpload(file.name, file.size);
      if (decision.action === 'reject') {
        failures.push(`${file.name}: ${decision.reason}`);
        continue;
      }
      try {
        let path: string;
        let size: number;
        if (decision.action === 'process') {
          const processed = await processImage(file);
          path = siteAssetPath(file.name, extForMime(processed.mime, file.name), theme);
          assetStore.stage(path, processed.blob);
          size = processed.processedSize;
        } else {
          path = siteAssetPath(file.name, extensionOf(file.name), theme);
          assetStore.stage(path, file);
          size = file.size;
        }
        onStage(path);
        const name = path.slice(path.lastIndexOf('/') + 1);
        setAssets((prev) =>
          upsert(prev, {
            path,
            name,
            ext: extensionOf(name),
            size,
            category: categorize(extensionOf(name)),
          }),
        );
      } catch (err) {
        failures.push(
          `${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (failures.length) setError(failures.join('\n'));
    setBusy(false);
    if (fileInput.current) fileInput.current.value = ''; // allow re-selecting the same file
  }

  function requestDelete(asset: SiteAsset): void {
    setPending({ asset, refs: findAssetReferences(asset.path, sources, theme) });
  }

  function confirmDelete(): void {
    if (!pending) return;
    onDelete([pending.asset.path]);
    setAssets((prev) => prev.filter((a) => a.path !== pending.asset.path));
    setPending(null);
  }

  return (
    <section className="asset-manager">
      <header className="asset-manager__head">
        <div>
          <h2>Assets</h2>
          <p className="asset-manager__hint">
            Shared theme files under <code>/assets</code> — fonts, logos, favicons. Images
            are optimised on upload; fonts and icons are stored as-is.
          </p>
        </div>
        <button
          type="button"
          className="is-primary"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {busy ? 'Uploading…' : 'Upload'}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => void onFiles(e.target.files)}
        />
      </header>

      {error ? (
        <div className="asset-manager__error" role="alert">
          {error.split('\n').map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      ) : null}

      {assets.length === 0 ? (
        <p className="object-list__empty">
          No assets yet. Upload a font, logo, or favicon to get started.
        </p>
      ) : (
        <ul className="asset-grid">
          {assets.map((asset) => (
            <li key={asset.path} className="asset-card">
              <AssetPreview asset={asset} assetStore={assetStore} />
              <div className="asset-card__meta">
                <span className="asset-card__name" title={asset.path}>
                  {asset.name}
                </span>
                <span className="asset-card__sub">
                  {CATEGORY_LABEL[asset.category]}
                  {asset.size !== undefined ? ` · ${formatBytes(asset.size)}` : ''}
                </span>
              </div>
              <button
                type="button"
                className="asset-card__delete"
                onClick={() => requestDelete(asset)}
                aria-label={`Delete ${asset.name}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {pending ? (
        <div className="modal" role="dialog" aria-label="Delete asset">
          <div className="modal__panel">
            <header className="modal__header">
              <h2>Delete {pending.asset.name}?</h2>
            </header>
            {pending.refs.length ? (
              <div className="asset-manager__error" role="alert">
                <strong>Still referenced by:</strong>
                <ul>
                  {pending.refs.map((r) => (
                    <li key={r}>
                      <code>{r}</code>
                    </li>
                  ))}
                </ul>
                Deleting it will break those until you update them.
              </div>
            ) : (
              <p>This removes the file from your branch on the next publish.</p>
            )}
            <div className="modal__actions">
              <button type="button" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button type="button" className="is-danger" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** A card's visual: an inline thumbnail for images, else a category tile with the extension. */
function AssetPreview({
  asset,
  assetStore,
}: {
  asset: SiteAsset;
  assetStore: AssetStore;
}): React.JSX.Element {
  const [url, setUrl] = useState<string | undefined>(() =>
    isThumbnailable(asset) ? assetStore.urlFor(asset.path) : undefined,
  );

  useEffect(() => {
    if (!isThumbnailable(asset)) return;
    const staged = assetStore.urlFor(asset.path);
    if (staged) {
      setUrl(staged);
      return;
    }
    let active = true;
    void assetStore.ensure(asset.path).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [asset, assetStore]);

  if (isThumbnailable(asset) && url) {
    return (
      <div className="asset-card__thumb">
        <img src={url} alt="" loading="lazy" />
      </div>
    );
  }
  return (
    <div className="asset-card__thumb asset-card__thumb--tile" aria-hidden="true">
      <span className="asset-card__ext">{asset.ext || 'file'}</span>
    </div>
  );
}
