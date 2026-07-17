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
 *
 * A `created` ISO timestamp is stamped into front matter so the content list can
 * offer a "creation date" sort (there's no database to record it otherwise). It's an
 * undeclared key the tolerant validator passes through, like `public`. Objects that
 * predate this stamp simply have no `created` and fall back to name order when sorted.
 */
export function newObject(
  type: string,
  title: string,
  schema: ContentTypeSchema,
  takenSlugs: Set<string>,
  lang?: string,
): ContentObject {
  const id = crypto.randomUUID();
  const slug = uniqueSlug(slugify(title), takenSlugs);
  const data: FrontMatter = {
    id,
    title: title.trim() || 'Untitled',
    created: new Date().toISOString(),
  };
  // On an i18n-enabled site every collection object belongs to a language (SPEC §5 →
  // Multilingual): stamp the (default) language into front matter and the bundle path
  // (content/<type>/<lang>/<slug>/) so its URL is prefixed like every other variant.
  if (lang) data.lang = lang;
  const dir = lang ? `content/${type}/${lang}/${slug}` : `content/${type}/${slug}`;
  const object: ContentObject = {
    type,
    kind: schema.kind,
    id,
    slug,
    path: `${dir}/index.md`,
    data,
    body: '',
    public: false,
  };
  if (lang) object.lang = lang;
  return object;
}
