import { parseVideoUrl } from '@timber/content';

interface VideoFieldProps {
  fieldKey: string;
  value: unknown;
  onChange: (value: string | undefined) => void;
}

/** A poster/thumbnail for the facade, where the provider exposes a stable URL. */
function thumbnailUrl(provider: 'youtube' | 'vimeo', id: string): string | undefined {
  return provider === 'youtube' ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : undefined;
}

/**
 * The `video` field widget (SPEC §7): a video is stored as **just a URL**, validated
 * against the provider allowlist. Reuses `parseVideoUrl` from `@timber/content` (the
 * same allowlist the content model validates with), shows the parsed provider + id
 * and a click-to-load **facade** thumbnail, and flags a disallowed host inline. The
 * embed iframe is constructed from the id in the template (Phase 6/7) — raw embed
 * HTML is never accepted.
 */
export function VideoField({ fieldKey, value, onChange }: VideoFieldProps): React.JSX.Element {
  const url = typeof value === 'string' ? value : '';
  const ref = url ? parseVideoUrl(url) : undefined;
  const invalid = url.length > 0 && !ref;
  const thumb = ref ? thumbnailUrl(ref.provider, ref.id) : undefined;

  return (
    <div className="video-field">
      <input
        id={`field-${fieldKey}`}
        type="url"
        value={url}
        placeholder="https://youtube.com/watch?v=… or https://vimeo.com/…"
        onChange={(e) => onChange(e.target.value || undefined)}
      />

      {invalid ? (
        <span className="video-field__error">Not an allow-listed video URL (YouTube or Vimeo).</span>
      ) : null}

      {ref ? (
        <div className="video-field__ok">
          <span>
            {ref.provider} · <code>{ref.id}</code>
          </span>
          {thumb ? <img className="video-field__facade" src={thumb} alt="video thumbnail" /> : null}
        </div>
      ) : null}
    </div>
  );
}
