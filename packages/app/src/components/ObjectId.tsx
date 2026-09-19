import { useState } from 'react';

interface ObjectIdProps {
  /** The object's immutable front-matter `id` (SPEC §5). */
  id: string;
}

/**
 * The object's `id`, shown read-only with a copy button (SPEC §5/§13).
 *
 * References store an id and display a title, so the editor has no reason to *show*
 * an id — until you hand-author a file that names one. `config/navigation.yml` is
 * exactly that case: its `ref:` entries are ids, and before this the only way to learn
 * one was to open `index.md` on GitHub. The id is deliberately not editable — it's the
 * stable identity everything else resolves through; the slug is the editable handle.
 */
export function ObjectId({ id }: ObjectIdProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied (insecure context, or the user said no) — the id is on screen
      // and selectable either way, so there's nothing worth interrupting them about.
    }
  }

  return (
    <span className="object-id">
      <span className="object-id__label">ID</span>
      <code className="object-id__value">{id}</code>
      <button
        type="button"
        className="object-id__copy"
        onClick={() => void copy()}
        title="Copy this ID — paste it into config/navigation.yml to link to this page"
        aria-label={copied ? 'ID copied' : 'Copy ID'}
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </span>
  );
}
