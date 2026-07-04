import { stringify as stringifyYaml } from 'yaml';
import type { FrontMatter } from '@timber/generator';

/**
 * Reassemble structured front-matter data + a Markdown body back into a raw
 * `index.md` string. The editor keeps data and body as separate state (data in
 * the schema form, body in Milkdown — SPEC §8), but the generator's `renderPage`
 * takes a whole `index.md`; reassembling and feeding it through `renderPage` means
 * live preview runs the EXACT code path the CI build runs (preview ≡ build), not a
 * parallel reimplementation.
 *
 * This is also the seed of Phase 5's save path (data+body → committed `index.md`).
 */
export function reassembleDocument(data: FrontMatter, body: string): string {
  const hasData = Object.keys(data).length > 0;
  if (!hasData) return body;
  // yaml.stringify ends with a newline; the blank line separates front matter
  // from the body, matching how parseFrontMatter strips it back off.
  return `---\n${stringifyYaml(data)}---\n\n${body}`;
}
