/**
 * The Timber wordmark, styled consistently everywhere it appears (SPEC §8 banner,
 * plus the sign-in screens). "Tim" — the author's name — is emphasised inside the
 * logo by weight and tone; see the `.wordmark` rules in `styles.css`.
 *
 * Renders inline, so drop it inside whatever heading the surface already uses
 * (`<h1 className="app__brand"><Wordmark /></h1>`) to keep the page's heading
 * semantics. The two spans are contiguous inline text, so assistive tech reads the
 * single word "Timber".
 */
export function Wordmark({ className }: { className?: string }): React.JSX.Element {
  return (
    <span className={className ? `wordmark ${className}` : 'wordmark'}>
      <span className="wordmark__tim">Tim</span>ber
    </span>
  );
}
