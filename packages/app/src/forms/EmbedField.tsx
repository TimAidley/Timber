import { embedUrlProblem, parseEmbedUrl } from '@timber/generator';

interface EmbedFieldProps {
  fieldKey: string;
  value: unknown;
  onChange: (value: string | undefined) => void;
}

/**
 * The `embed` field widget (SPEC §7): an embed is stored as **just a URL**, resolved
 * to an iframe `src` by `parseEmbedUrl` from `@timber/generator` — the same resolution
 * the content model validates with, so the inline message here and the publish gate
 * agree. Shows what the URL resolved to (a provider's video id, or a page that embeds
 * as itself) and a facade thumbnail where the provider exposes one. Raw embed HTML is
 * never accepted; the iframe is built at render time from the resolved ref.
 */
export function EmbedField({
  fieldKey,
  value,
  onChange,
}: EmbedFieldProps): React.JSX.Element {
  const url = typeof value === 'string' ? value : '';
  const ref = url ? parseEmbedUrl(url) : undefined;
  const problem = url ? embedUrlProblem(url) : undefined;

  return (
    <div className="embed-field">
      <input
        id={`field-${fieldKey}`}
        type="url"
        value={url}
        placeholder="https://… (a page to embed, or a YouTube / Vimeo link)"
        onChange={(e) => onChange(e.target.value || undefined)}
      />

      {problem ? <span className="embed-field__error">This URL {problem}.</span> : null}

      {ref ? (
        <div className="embed-field__ok">
          <span>
            {ref.provider === 'direct' ? (
              'embeds as itself'
            ) : (
              <>
                {ref.provider} · <code>{ref.id}</code>
              </>
            )}
          </span>
          {ref.poster ? (
            <img className="embed-field__facade" src={ref.poster} alt="embed thumbnail" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
