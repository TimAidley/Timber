import { stringify as stringifyYaml } from 'yaml';
import { parseFrontMatter } from './frontmatter.js';
import type { FrontMatter } from './types.js';

/**
 * The on-disk `index.md` format — the exact inverse of {@link parseFrontMatter}.
 *
 * This lives here, beside the parser, because the two must never drift: the editor
 * writes every save through {@link serializeDocument}, so ANY other producer of content
 * (an importer, a migration script, a hand-authored file) has to match it byte-for-byte
 * or the object shows as modified the instant the editor loads it — a phantom diff that
 * survives a revert, because reverting restores the non-canonical bytes and the editor
 * immediately re-serialises them. Keeping the format in one exported function is what
 * lets a generator/importer be *correct by construction* instead of by imitation.
 */

/**
 * Reassemble front-matter data + a Markdown body into a raw `index.md` string.
 *
 * The shape is `---\n<yaml>---\n\n<body>`: `yaml.stringify` already ends with a newline,
 * and the extra blank line is the front-matter/body separator that `parseFrontMatter`
 * strips back off. An object with no front matter is just its body, so a plain Markdown
 * file round-trips untouched.
 */
export function serializeDocument(data: FrontMatter, body: string): string {
  if (Object.keys(data).length === 0) return body;
  return `---\n${stringifyYaml(data)}---\n\n${body}`;
}

/**
 * Rewrite a raw `index.md` into canonical form by parsing and re-serialising it.
 *
 * Idempotent: `formatDocument(formatDocument(x)) === formatDocument(x)`, which is what
 * makes it safe to run in a pre-commit hook or a CI check. Content is preserved exactly
 * — only the YAML's own formatting (quoting, line wrapping, indentation) and the
 * front-matter/body separator are normalised, so the rendered site is unaffected.
 */
export function formatDocument(raw: string): string {
  const { data, body } = parseFrontMatter(raw);
  return serializeDocument(data, body);
}

/**
 * Whether a raw `index.md` is already in the form the editor would write. A `false`
 * here is exactly the condition that makes an untouched object look "changed" in the
 * editor; `timber fmt` fixes it.
 */
export function isCanonicalDocument(raw: string): boolean {
  return formatDocument(raw) === raw;
}
