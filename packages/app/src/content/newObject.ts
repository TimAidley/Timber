import { slugify, uniqueSlug, type ContentObject, type ContentTypeSchema } from '@timber/content';
import type { FrontMatter } from '@timber/generator';

/**
 * Build a brand-new collection object (SPEC §5 object creation). Generates the
 * immutable `id` (via `crypto.randomUUID`, browser-native — kept in the app rather
 * than the isomorphic content package to avoid its `types: []` DOM-global friction),
 * derives a unique slug from the title, and seeds minimal front matter.
 *
 * Required fields are deliberately left blank: a new object is a **draft** until the
 * author fills them and validation passes (SPEC §5 draft-by-default; `public` is
 * absent, so it's private). Singletons aren't created here — there is exactly one.
 */
export function newObject(
  type: string,
  title: string,
  schema: ContentTypeSchema,
  takenSlugs: Set<string>,
): ContentObject {
  const id = crypto.randomUUID();
  const slug = uniqueSlug(slugify(title), takenSlugs);
  const data: FrontMatter = { id, title: title.trim() || 'Untitled' };
  return {
    type,
    kind: schema.kind,
    id,
    slug,
    path: `content/${type}/${slug}/index.md`,
    data,
    body: '',
    public: false,
  };
}
