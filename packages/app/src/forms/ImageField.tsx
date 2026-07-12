import { useState } from 'react';
import { processImage } from '../media/processImage.js';
import { bundleImagePath } from '../media/assetName.js';
import type { ProcessedImage } from '../media/types.js';
import type { AssetStore } from '../state/assets.js';

interface ImageFieldProps {
  fieldKey: string;
  /** Current stored asset path (repo-relative). */
  value: unknown;
  /** Current alt text (stored in a sibling `<key>Alt` front-matter key). */
  alt: unknown;
  onChangePath: (path: string | undefined) => void;
  onChangeAlt: (alt: string | undefined) => void;
  assetStore: AssetStore;
  /** The object's bundle directory, e.g. `content/events/summer-fete`. */
  bundleDir: string;
  /** Notified with the staged asset's repo path so autosave can commit its bytes. */
  onStaged?: ((path: string) => void) | undefined;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function describe(result: ProcessedImage): string {
  const from = formatBytes(result.originalSize);
  const to = formatBytes(result.processedSize);
  const dims = result.width && result.height ? ` · ${result.width}×${result.height}` : '';
  switch (result.action) {
    case 'reencode':
      return result.keptOriginal
        ? `kept original (already smaller), ${to}${dims}`
        : `re-encoded to WebP, ${from} → ${to}${dims}`;
    case 'passthrough-svg':
      return `SVG sanitized, ${to}`;
    case 'passthrough-gif':
      return `animated GIF kept as-is, ${to}`;
  }
}

/**
 * The `image` field widget (SPEC §7/§8): upload → in-browser process (resize/
 * re-encode to WebP, sanitize SVG, keep animated GIF) → stage the bytes and store
 * the bundle path. Shows a live thumbnail + what the pipeline did, and requires
 * **alt text** (mandatory for accessibility — caption ≠ alt).
 */
export function ImageField({
  fieldKey,
  value,
  alt,
  onChangePath,
  onChangeAlt,
  assetStore,
  bundleDir,
  onStaged,
}: ImageFieldProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessedImage | null>(null);

  const path = typeof value === 'string' ? value : '';
  const previewUrl = path ? assetStore.urlFor(path) : undefined;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(`Not an image: ${file.type || 'unknown type'}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const processed = await processImage(file);
      const target = bundleImagePath(bundleDir, file.name, processed.mime);
      assetStore.stage(target, processed.blob);
      setResult(processed);
      onChangePath(target);
      onStaged?.(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="image-field">
      <input id={`field-${fieldKey}`} type="file" accept="image/*" onChange={onFile} />
      {busy ? <span className="image-field__status">processing…</span> : null}
      {error ? <span className="image-field__error">{error}</span> : null}

      {previewUrl ? (
        <div className="image-field__preview">
          <img src={previewUrl} alt={typeof alt === 'string' ? alt : ''} />
          <code>{path}</code>
          {result ? <span className="image-field__stats">{describe(result)}</span> : null}
        </div>
      ) : null}

      <label className="image-field__alt">
        Alt text <span className="schema-form__required">*</span>
        <input
          type="text"
          value={typeof alt === 'string' ? alt : ''}
          placeholder="describe the image for screen readers"
          onChange={(e) => onChangeAlt(e.target.value || undefined)}
        />
      </label>
    </div>
  );
}
