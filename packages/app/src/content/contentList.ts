import type { ContentObject, ContentTypeSchema } from '@timber/content';

/**
 * Pure helpers for the content list's group / sort / filter behaviour (SPEC §5 nav).
 * Kept out of the React component so the ordering rules can be unit-tested directly.
 *
 * Objects are grouped by content type; within a group they can be sorted by name,
 * creation date, or any of that type's declared fields, and filtered by name. Two
 * sort keys are synthetic (not schema fields) and use a `__` prefix so they can never
 * collide with a real field key: `__name` (the object's display title) and `__created`
 * (the `created` front-matter stamp written at creation time).
 */
export const NAME_SORT = '__name';
export const CREATED_SORT = '__created';

export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: string;
  dir: SortDir;
}

export interface TypeGroup {
  type: string;
  objects: ContentObject[];
}

export interface SortOption {
  value: string;
  label: string;
}

/** The list's display name for an object: its title if set, else the slug. */
export function objectName(o: ContentObject): string {
  const title = o.data.title;
  return String(title ?? o.slug);
}

/**
 * A translation cluster (SPEC §5 → Multilingual): all the language variants of one
 * logical object, keyed by their shared `translationKey`. An object with no key is its
 * own singleton cluster. The `representative` drives the row's title, sort, and secondary
 * text so the sidebar reads by a primary language.
 */
export interface TranslationCluster {
  /** The shared translationKey, or `__lone:<path>` for an untranslated object. */
  key: string;
  /** The variant that drives display/sort: default-language if present, else lowest site-language rank. */
  representative: ContentObject;
  /** lang → object for each present variant (`''` for a language-less object). */
  variants: Map<string, ContentObject>;
}

/**
 * Collapse a type group's objects into translation clusters. Objects sharing a
 * `translationKey` become one cluster; the representative is the default-language variant
 * when present, else the variant whose language comes first in `siteLanguages` (path as a
 * stable tiebreak). Group order follows the representatives (the caller sorts).
 */
export function clusterTranslations(
  objects: readonly ContentObject[],
  siteLanguages: readonly string[],
  defaultLanguage: string,
): TranslationCluster[] {
  const groups = new Map<string, ContentObject[]>();
  for (const o of objects) {
    const key = o.translationKey ?? `__lone:${o.path}`;
    const arr = groups.get(key);
    if (arr) arr.push(o);
    else groups.set(key, [o]);
  }
  const rank = new Map(siteLanguages.map((l, i) => [l, i] as const));
  const rankOf = (o: ContentObject): number =>
    o.lang && rank.has(o.lang) ? (rank.get(o.lang) as number) : Number.MAX_SAFE_INTEGER;

  const clusters: TranslationCluster[] = [];
  for (const [key, objs] of groups) {
    const variants = new Map<string, ContentObject>();
    for (const o of objs) {
      const lang = o.lang ?? '';
      if (!variants.has(lang)) variants.set(lang, o); // first-seen wins on a stray duplicate
    }
    const representative =
      variants.get(defaultLanguage) ??
      [...variants.values()].sort(
        (a, b) => rankOf(a) - rankOf(b) || (a.path < b.path ? -1 : 1),
      )[0]!;
    clusters.push({ key, representative, variants });
  }
  return clusters;
}

/** The site languages a cluster has no variant for — its translation gaps. */
export function clusterMissingLanguages(
  cluster: TranslationCluster,
  siteLanguages: readonly string[],
): string[] {
  return siteLanguages.filter((l) => !cluster.variants.has(l));
}

/** Filter clusters by name across **all** variants (so searching "bonjour" finds the group). */
export function filterClusters(
  clusters: readonly TranslationCluster[],
  query: string,
): TranslationCluster[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...clusters];
  return clusters.filter((c) =>
    [...c.variants.values()].some((o) => objectName(o).toLowerCase().includes(q)),
  );
}

/** Sort clusters by their representative, reusing the object sort rules. */
export function sortClusters(
  clusters: readonly TranslationCluster[],
  sort: SortState,
  schema: ContentTypeSchema | undefined,
): TranslationCluster[] {
  const byRep = new Map(clusters.map((c) => [c.representative, c] as const));
  return sortObjects(
    clusters.map((c) => c.representative),
    sort,
    schema,
  ).map((rep) => byRep.get(rep) as TranslationCluster);
}

/** Group objects by content type, groups ordered alphabetically by type name. */
export function groupByType(objects: readonly ContentObject[]): TypeGroup[] {
  const groups = new Map<string, ContentObject[]>();
  for (const o of objects) {
    const arr = groups.get(o.type);
    if (arr) arr.push(o);
    else groups.set(o.type, [o]);
  }
  return [...groups.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((type) => ({ type, objects: groups.get(type) as ContentObject[] }));
}

/** Filter by name (case-insensitive substring); an empty query keeps everything. */
export function filterByName(
  objects: readonly ContentObject[],
  query: string,
): ContentObject[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...objects];
  return objects.filter((o) => objectName(o).toLowerCase().includes(q));
}

/** The sort choices for a group: Name, Created, then each of the type's fields. */
export function sortOptions(schema: ContentTypeSchema | undefined): SortOption[] {
  const options: SortOption[] = [
    { value: NAME_SORT, label: 'Name' },
    { value: CREATED_SORT, label: 'Created' },
  ];
  if (schema) {
    for (const [key, field] of Object.entries(schema.fields)) {
      // `title` already drives the Name sort — don't offer it twice.
      if (key === 'title') continue;
      options.push({ value: key, label: field.label ?? key });
    }
  }
  return options;
}

function isEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    v === '' ||
    (Array.isArray(v) && v.length === 0)
  );
}

/** The raw value a sort key reads from an object. */
function sortValue(o: ContentObject, key: string): unknown {
  if (key === NAME_SORT) return objectName(o);
  if (key === CREATED_SORT) return o.data.created;
  return o.data[key];
}

/** Compare two present (non-empty) values under the field kind driving the sort. */
function compareValues(a: unknown, b: unknown, kind: string | undefined): number {
  switch (kind) {
    case 'number': {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isNaN(na) || Number.isNaN(nb)) return String(a).localeCompare(String(b));
      return na - nb;
    }
    case 'boolean':
      return (a === true ? 1 : 0) - (b === true ? 1 : 0);
    case 'date':
    case 'datetime': {
      const ta = Date.parse(String(a));
      const tb = Date.parse(String(b));
      if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
      return String(a).localeCompare(String(b));
    }
    default: {
      const sa = Array.isArray(a) ? a.join(', ') : String(a);
      const sb = Array.isArray(b) ? b.join(', ') : String(b);
      return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
    }
  }
}

/**
 * Sort a group's objects by the given key/direction. Empty values always sort last
 * (regardless of direction) so blanks don't crowd the top; ties break by name so the
 * order is stable and predictable.
 */
export function sortObjects(
  objects: readonly ContentObject[],
  sort: SortState,
  schema: ContentTypeSchema | undefined,
): ContentObject[] {
  const kind =
    sort.key === NAME_SORT
      ? 'text'
      : sort.key === CREATED_SORT
        ? 'datetime'
        : schema?.fields[sort.key]?.type;
  const factor = sort.dir === 'desc' ? -1 : 1;
  return [...objects].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    const ea = isEmpty(va);
    const eb = isEmpty(vb);
    if (ea && eb) return objectName(a).localeCompare(objectName(b));
    if (ea) return 1;
    if (eb) return -1;
    const c = compareValues(va, vb, kind);
    if (c !== 0) return factor * c;
    return objectName(a).localeCompare(objectName(b));
  });
}
