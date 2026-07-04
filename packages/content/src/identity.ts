/**
 * Slug + id helpers for the object lifecycle (SPEC §5). Slugs are the editable
 * folder names that drive URLs; each referenceable object also carries an
 * immutable `id` (generated once at creation, in the app via `crypto.randomUUID`).
 * These helpers are pure strings so they stay isomorphic — the content package
 * builds with `types: []`, so no DOM/Node globals here.
 */

/**
 * Turn a human title into a URL-safe slug: lowercase, spaces/underscores → `-`,
 * strip anything outside `[a-z0-9-]`, and collapse/trim dashes. An empty or
 * all-punctuation title yields `''` — the caller decides the fallback.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Return a slug not already in `taken`, appending `-2`, `-3`… until free. A blank
 * `base` (e.g. an untitled object) falls back to `untitled`. Used when creating or
 * renaming an object so two bundles never collide within a type.
 */
export function uniqueSlug(base: string, taken: Set<string>): string {
  const root = base || 'untitled';
  if (!taken.has(root)) return root;
  for (let n = 2; ; n += 1) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
