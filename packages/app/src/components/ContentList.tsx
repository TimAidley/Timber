import { useEffect, useMemo, useState } from 'react';
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

/** Above this many site languages the control drops the codes for an "N/M" summary. */
const LANG_CODES_MAX = 3;

/** A language's own name for the menu (endonym), falling back to the bare code. */
function languageName(code: string): string {
  try {
    return (
      new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code.toUpperCase()
    );
  } catch {
    return code.toUpperCase();
  }
}

/**
 * Human-readable secondary line, showing the value the group is sorted by. Under the
 * default Name sort there's nothing to add — the title already *is* that value — so it
 * returns '' and the row stays a single line (the slug just duplicated the title and
 * crowded the list). Other sorts surface their key's value as useful context.
 */
function secondaryText(o: ContentObject, sort: SortState): string {
  if (sort.key === NAME_SORT) return '';
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
  // Which cluster's translations menu is open (by cluster key), or null. A document-level
  // listener closes it on an outside click or Escape; the control and its rows stopPropagation
  // so their own clicks don't immediately re-close it.
  const [openLangMenu, setOpenLangMenu] = useState<string | null>(null);
  const i18n = languages.length > 0;

  useEffect(() => {
    if (openLangMenu === null) return;
    const close = (): void => setOpenLangMenu(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenLangMenu(null);
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [openLangMenu]);

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
            {/* Draft/Public trails the title so it isn't orphaned once the slug line is gone. */}
            {!deviceOnlyPaths.has(o.path) && (schemas.get(o.type)?.page ?? true) ? (
              <VisibilityBadge isPublic={o.public} />
            ) : null}
          </span>
          {secondaryText(o, sort) ? (
            <span className="object-list__type">{secondaryText(o, sort)}</span>
          ) : null}
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
      <li key={cluster.key} className={`object-cluster${activeInCluster ? ' is-active' : ''}`}>
        <button
          type="button"
          className={[
            'object-cluster__main',
            activeInCluster ? 'is-active' : '',
            deletedPaths.has(rep.path) ? 'is-deleting' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onSelect(rep.path)}
        >
          <span className="object-list__title">
            {deviceOnlyPaths.has(rep.path) ? <DeviceBadge /> : <ChangeBadge state={changeStateOf(rep.path)} />}
            {objectName(rep)}
          </span>
          {secondaryText(rep, sort) ? (
            <span className="object-list__type">{secondaryText(rep, sort)}</span>
          ) : null}
        </button>
        {languageControl(cluster)}
      </li>
    );
  }

  // The right-hand language control for a cluster: an adaptive summary button (codes when
  // there are few languages, an "N/M" coverage fraction with pips when there are many) that
  // opens a menu of every site language with its status and a jump. One tidy line per row,
  // whatever the language count — replacing the loose, unaligned chip strip.
  function languageControl(cluster: TranslationCluster): React.JSX.Element {
    const open = openLangMenu === cluster.key;
    const present = languages.filter((l) => cluster.variants.has(l)).length;
    const compact = languages.length > LANG_CODES_MAX;
    const statusOf = (v: ContentObject | undefined): 'public' | 'draft' | 'missing' =>
      !v ? 'missing' : v.public ? 'public' : 'draft';

    return (
      <>
        <button
          type="button"
          className="langctl"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Translations — ${present} of ${languages.length} languages`}
          onClick={(e) => {
            e.stopPropagation();
            setOpenLangMenu(open ? null : cluster.key);
          }}
        >
          {compact ? (
            <>
              <span className="langctl__globe" aria-hidden="true">
                🌐
              </span>
              <span className="langctl__frac">
                <b>{present}</b>/{languages.length}
              </span>
              <span className="langctl__pips" aria-hidden="true">
                {languages.map((lang) => {
                  const st = statusOf(cluster.variants.get(lang));
                  return (
                    <i
                      key={lang}
                      className={`langctl__pip${st === 'missing' ? '' : ` is-${st}`}`}
                    />
                  );
                })}
              </span>
            </>
          ) : (
            languages.map((lang) => {
              const st = statusOf(cluster.variants.get(lang));
              return (
                <span key={lang} className={`langctl__code is-${st}`}>
                  {lang}
                </span>
              );
            })
          )}
          <span className="langctl__caret" aria-hidden="true">
            ▾
          </span>
        </button>
        {open ? (
          <div
            className="langmenu"
            role="menu"
            aria-label={`${objectName(cluster.representative)} — translations`}
          >
            <div className="langmenu__head">Translations</div>
            {languages.map((lang) => {
              const variant = cluster.variants.get(lang);
              const st = statusOf(variant);
              const label =
                st === 'public' ? 'Public' : st === 'draft' ? 'Draft' : 'Not translated';
              const isCurrent = variant?.path === selectedPath;
              return (
                <button
                  key={lang}
                  type="button"
                  role="menuitem"
                  className={`langmenu__row is-${st}${isCurrent ? ' is-current' : ''}`}
                  disabled={!variant}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (variant) {
                      onSelect(variant.path);
                      setOpenLangMenu(null);
                    }
                  }}
                >
                  <span className="langmenu__code">{lang}</span>
                  <span className="langmenu__name">{languageName(lang)}</span>
                  <span className={`langmenu__status is-${st}`}>{label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </>
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
