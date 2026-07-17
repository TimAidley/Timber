import { useMemo, useState } from 'react';
import type { ContentObject, ContentTypeSchema } from '@timber/content';
import { ChangeBadge, DeviceBadge, VisibilityBadge } from './ChangeBadges.js';
import { objectChangeState } from '../state/changes.js';
import {
  CREATED_SORT,
  NAME_SORT,
  clusterMissingLanguages,
  clusterTranslations,
  filterByName,
  filterClusters,
  groupByType,
  objectName,
  sortClusters,
  sortObjects,
  sortOptions,
  type SortState,
  type TranslationCluster,
} from '../content/contentList.js';

interface ContentListProps {
  objects: ContentObject[];
  schemas: Map<string, ContentTypeSchema>;
  selectedPath: string;
  editingPaths: ReadonlySet<string>;
  savedPaths: ReadonlySet<string>;
  deletedPaths: ReadonlySet<string>;
  /** Objects kept On this device (SPEC §5/§8): badged distinctly, not on the host. */
  deviceOnlyPaths?: ReadonlySet<string>;
  onSelect: (path: string) => void;
  /** The site's declared languages (SPEC §5 → Multilingual); empty/omitted ⇒ single-language, no clustering. */
  languages?: string[];
  defaultLanguage?: string;
}

const DEFAULT_SORT: SortState = { key: NAME_SORT, dir: 'asc' };
const EMPTY: ReadonlySet<string> = new Set();

/** Human-readable secondary line, showing the value the group is sorted by. */
function secondaryText(o: ContentObject, sort: SortState): string {
  if (sort.key === NAME_SORT) return o.slug;
  if (sort.key === CREATED_SORT) {
    const created = o.data.created;
    if (typeof created !== 'string') return '—';
    const t = Date.parse(created);
    return Number.isNaN(t) ? created : new Date(t).toLocaleDateString();
  }
  const v = o.data[sort.key];
  if (v === undefined || v === null || v === '') return '—';
  return Array.isArray(v) ? v.join(', ') : String(v);
}

/**
 * The content navigator (SPEC §5): objects grouped by type, each group sortable by
 * name, creation date, or any of the type's fields, with a name filter across all
 * groups. Sort state is kept per type so each group orders independently — "any field
 * in the type" only makes sense against that type's own schema.
 *
 * On an **i18n-enabled** site (SPEC §5 → Multilingual) each row is a **translation
 * cluster**: its language variants collapse into one entry carrying a chip strip — a chip
 * per site language (present → jump to that variant, missing → a muted gap), so coverage
 * reads at a glance. A "Needs translation" filter narrows to clusters with gaps (the
 * missing-translations overview). Single-language sites keep the plain one-row-per-object list.
 */
export function ContentList({
  objects,
  schemas,
  selectedPath,
  editingPaths,
  savedPaths,
  deletedPaths,
  deviceOnlyPaths = EMPTY,
  onSelect,
  languages = [],
  defaultLanguage = '',
}: ContentListProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [sorts, setSorts] = useState<Record<string, SortState>>({});
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const i18n = languages.length > 0;

  const groups = useMemo(() => groupByType(objects), [objects]);

  function sortFor(type: string): SortState {
    return sorts[type] ?? DEFAULT_SORT;
  }
  function setSortKey(type: string, key: string): void {
    setSorts((prev) => ({ ...prev, [type]: { key, dir: (prev[type] ?? DEFAULT_SORT).dir } }));
  }
  function toggleDir(type: string): void {
    setSorts((prev) => {
      const cur = prev[type] ?? DEFAULT_SORT;
      return { ...prev, [type]: { ...cur, dir: cur.dir === 'asc' ? 'desc' : 'asc' } };
    });
  }

  const changeStateOf = (path: string): ReturnType<typeof objectChangeState> =>
    objectChangeState(path, editingPaths, savedPaths, deletedPaths);

  // One list row for a single object (the single-language path, and the shape a cluster
  // chip navigates to).
  function objectRow(o: ContentObject, sort: SortState): React.JSX.Element {
    return (
      <li key={o.path}>
        <button
          type="button"
          className={[o.path === selectedPath ? 'is-active' : '', deletedPaths.has(o.path) ? 'is-deleting' : '']
            .filter(Boolean)
            .join(' ')}
          onClick={() => onSelect(o.path)}
        >
          <span className="object-list__title">
            {deviceOnlyPaths.has(o.path) ? <DeviceBadge /> : <ChangeBadge state={changeStateOf(o.path)} />}
            {objectName(o)}
          </span>
          <span className="object-list__type">
            {!deviceOnlyPaths.has(o.path) && (schemas.get(o.type)?.page ?? true) ? (
              <VisibilityBadge isPublic={o.public} />
            ) : null}
            {secondaryText(o, sort)}
          </span>
        </button>
      </li>
    );
  }

  // One list row for a translation cluster: the representative drives title/meta; a chip
  // strip shows every site language (present → select that variant; missing → muted gap).
  function clusterRow(cluster: TranslationCluster, sort: SortState): React.JSX.Element {
    const rep = cluster.representative;
    const activeInCluster = [...cluster.variants.values()].some((v) => v.path === selectedPath);
    return (
      <li key={cluster.key}>
        <button
          type="button"
          className={[activeInCluster ? 'is-active' : '', deletedPaths.has(rep.path) ? 'is-deleting' : '']
            .filter(Boolean)
            .join(' ')}
          onClick={() => onSelect(rep.path)}
        >
          <span className="object-list__title">
            {deviceOnlyPaths.has(rep.path) ? <DeviceBadge /> : <ChangeBadge state={changeStateOf(rep.path)} />}
            {objectName(rep)}
          </span>
          <span className="object-list__type">{secondaryText(rep, sort)}</span>
        </button>
        <div className="object-list__langs" role="group" aria-label="Translations">
          {languages.map((lang) => {
            const variant = cluster.variants.get(lang);
            if (!variant) {
              return (
                <span
                  key={lang}
                  className="object-list__lang is-missing"
                  title={`${lang}: not translated`}
                >
                  {lang}
                </span>
              );
            }
            return (
              <button
                key={lang}
                type="button"
                className={[
                  'object-list__lang',
                  variant.path === selectedPath ? 'is-active' : '',
                  variant.public ? '' : 'is-draft',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelect(variant.path)}
                title={`${lang}${variant.public ? '' : ' — draft'}`}
              >
                {lang}
              </button>
            );
          })}
        </div>
      </li>
    );
  }

  const rendered = groups
    .map((group) => {
      const schema = schemas.get(group.type);
      const sort = sortFor(group.type);
      if (i18n) {
        let clusters = filterClusters(
          clusterTranslations(group.objects, languages, defaultLanguage),
          query,
        );
        if (incompleteOnly) {
          clusters = clusters.filter((c) => clusterMissingLanguages(c, languages).length > 0);
        }
        clusters = sortClusters(clusters, sort, schema);
        return { ...group, schema, sort, clusters, count: clusters.length };
      }
      const items = sortObjects(filterByName(group.objects, query), sort, schema);
      return { ...group, schema, sort, items, count: items.length };
    })
    .filter((g) => g.count > 0);

  return (
    <>
      <div className="object-list__search">
        <input
          type="search"
          className="object-list__search-input"
          placeholder="Search by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search content by name"
        />
        {i18n ? (
          <label className="object-list__filter">
            <input
              type="checkbox"
              checked={incompleteOnly}
              onChange={(e) => setIncompleteOnly(e.target.checked)}
            />
            Needs translation
          </label>
        ) : null}
      </div>

      {rendered.length === 0 ? (
        <p className="object-list__empty">{incompleteOnly ? 'Everything is translated.' : 'No matches.'}</p>
      ) : (
        rendered.map((group) => (
          <section className="object-group" key={group.type}>
            <div className="object-group__head">
              <span className="object-group__name">
                {group.type}
                <span className="object-group__count">{group.count}</span>
              </span>
              {group.objects.length > 1 ? (
                <div className="object-group__sort">
                  <label className="visually-hidden" htmlFor={`sort-${group.type}`}>
                    Sort {group.type} by
                  </label>
                  <select
                    id={`sort-${group.type}`}
                    className="object-group__sort-key"
                    value={group.sort.key}
                    onChange={(e) => setSortKey(group.type, e.target.value)}
                  >
                    {sortOptions(group.schema).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="object-group__sort-dir"
                    onClick={() => toggleDir(group.type)}
                    aria-label={group.sort.dir === 'asc' ? 'Sort ascending' : 'Sort descending'}
                    title={group.sort.dir === 'asc' ? 'Ascending' : 'Descending'}
                  >
                    {group.sort.dir === 'asc' ? '▲' : '▼'}
                  </button>
                </div>
              ) : null}
            </div>

            <ul className="object-list">
              {'clusters' in group
                ? group.clusters.map((c) => clusterRow(c, group.sort))
                : group.items.map((o) => objectRow(o, group.sort))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
