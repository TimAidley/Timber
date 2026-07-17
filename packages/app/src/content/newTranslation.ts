import { uniqueSlug, type ContentObject } from '@timber/content';
import type { FrontMatter } from '@timber/generator';

export interface NewTranslationResult {
  /** The new sibling bundle in the target language. */
  translation: ContentObject;
  /**
   * The shared translation key. When the source had none, one is minted here and the
   * caller must also write it onto the source, so both sides of the group link.
   */
  translationKey: string;
  /** True when `translationKey` was freshly minted (the source needs it backfilled). */
  mintedKey: boolean;
}

/**
 * Build a new translation (a sibling bundle) of `source` in `targetLang` — the model
 * side of the editor's "Add translation" action (SPEC §5 → Multilingual). Per the
 * settled decision it **duplicates the source as a draft** starting point: a fresh `id`,
 * the shared `translationKey` (minted if the source lacked one), `lang` set to the target,
 * the body and every field copied so the translator edits in place, front-matter image
 * paths repointed into the new bundle, and a new `created` stamp. `public` and `aliases`
 * are dropped — a new variant is private until translated and inherits no old URLs.
 *
 * Colocated **assets** are copied by the caller (via blob-SHA re-adds) rather than here,
 * since that needs the loaded tree; this function is pure so it stays unit-testable.
 */
export function newTranslation(
  source: ContentObject,
  targetLang: string,
  takenSlugs: Set<string>,
): NewTranslationResult {
  const existingKey =
    typeof source.data.translationKey === 'string' && source.data.translationKey
      ? source.data.translationKey
      : undefined;
  const translationKey = existingKey ?? crypto.randomUUID();
  const mintedKey = existingKey === undefined;

  const id = crypto.randomUUID();
  // Slugs live in a per-(type, language) namespace, so the source slug is usually free
  // in the new language; `takenSlugs` (the target language's slugs) guards the rare clash.
  const slug = uniqueSlug(source.slug, takenSlugs);
  const oldDir = source.path.replace(/\/index\.md$/, '');
  const newDir = `content/${source.type}/${targetLang}/${slug}`;

  const data: FrontMatter = {};
  for (const [k, v] of Object.entries(source.data)) {
    if (k === 'public' || k === 'aliases') continue;
    // Repoint any front-matter path (e.g. an image field) that lived in the old bundle.
    data[k] =
      typeof v === 'string' && v.startsWith(`${oldDir}/`)
        ? `${newDir}/${v.slice(oldDir.length + 1)}`
        : v;
  }
  data.id = id;
  data.lang = targetLang;
  data.translationKey = translationKey;
  data.created = new Date().toISOString();

  const translation: ContentObject = {
    type: source.type,
    kind: source.kind,
    id,
    slug,
    lang: targetLang,
    translationKey,
    path: `${newDir}/index.md`,
    data,
    body: source.body,
    public: false,
  };
  return { translation, translationKey, mintedKey };
}
