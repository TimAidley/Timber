/**
 * The object-bundle path grammar (SPEC §4/§5), in ONE place. Three shapes exist:
 *
 *   content/<type>/index.md                   -> singleton (no slug, no lang)
 *   content/<type>/<slug>/index.md            -> collection object (slug = <slug>)
 *   content/<type>/<lang>/<slug>/index.md     -> collection object in language <lang>
 *
 * Every consumer — the assembler, the editor's pending-deletion derivation, the
 * change classifier — must parse paths through here rather than keeping its own
 * regex. Two hand-rolled copies of this grammar once drifted (the editor's copy
 * predated the multilingual shape), and deleted translations silently stopped being
 * recognised as objects; a single exported grammar makes that class of bug
 * unwritable.
 */

// The two optional segments are captured greedily: a lone segment is the slug
// (group 2); two segments are (lang, slug) (groups 2, 3). Slugs are single path
// components, so depth disambiguates cleanly — no nested collections exist to make
// three levels ambiguous.
const OBJECT_PATH = /^content\/([^/]+)\/(?:([^/]+)\/)?(?:([^/]+)\/)?index\.md$/;

export interface ParsedObjectPath {
  type: string;
  /** Present only for the four-segment multilingual shape. */
  lang?: string;
  /** Present for collection shapes; absent for a singleton. */
  slug?: string;
}

/** Parse an object `index.md` path into its parts, or undefined for any other path. */
export function parseObjectPath(path: string): ParsedObjectPath | undefined {
  const match = OBJECT_PATH.exec(path);
  if (!match) return undefined;
  const parsed: ParsedObjectPath = { type: match[1]! };
  // A lone middle segment is the slug; two segments are (lang, slug).
  const lang = match[3] !== undefined ? match[2] : undefined;
  const slug = match[3] ?? match[2];
  if (lang !== undefined) parsed.lang = lang;
  if (slug !== undefined) parsed.slug = slug;
  return parsed;
}

/**
 * A collection object's `index.md` — either collection shape, with or without a
 * language segment. These are the user-deletable objects (singletons never are), so
 * this is the filter for "which removed paths were object deletions".
 */
export function isCollectionIndexPath(path: string): boolean {
  const parsed = parseObjectPath(path);
  return parsed !== undefined && parsed.slug !== undefined;
}

/**
 * Any path inside the content area (`content/**`). Content-area paths always belong
 * to an object — a bundle's `index.md`, a colocated asset, or the leftovers of a
 * renamed/deleted bundle — never to the site's templates/config/theme files, so
 * change tallies must not double-count them as loose "site files".
 */
export function isContentPath(path: string): boolean {
  return path.startsWith('content/');
}
