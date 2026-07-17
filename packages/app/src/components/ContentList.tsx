import { useMemo, useState } from 'react';
import type { ContentObject, ContentTypeSchema } from '@timber/content';
import { ChangeBadge, VisibilityBadge } from './ChangeBadges.js';
import { objectChangeState } from '../state/changes.js';
import {
  CREATED_SORT,
  NAME_SORT,
  filterByName,
  groupByType,
  objectName,
  sortObjects,
  sortOptions,
  type SortState,
} from '../content/contentList.js';

interface ContentListProps {
  objects: ContentObject[];
  schemas: Map<string, ContentTypeSchema>;
  selectedPath: string;
  editingPaths: ReadonlySet<string>;
  savedPaths: ReadonlySet<string>;
  deletedPaths: ReadonlySet<string>;
  onSelect: (path: string) => void;
}

const DEFAULT_SORT: SortState = { key: NAME_SORT, dir: 'asc' };

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
 */
export function ContentList({
  objects,
  schemas,
  selectedPath,
  editingPaths,
  savedPaths,
  deletedPaths,
  onSelect,
}: ContentListProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [sorts, setSorts] = useState<Record<string, SortState>>({});

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

  const rendered = groups
    .map((group) => {
      const schema = schemas.get(group.type);
      const sort = sortFor(group.type);
      const items = sortObjects(filterByName(group.objects, query), sort, schema);
      return { ...group, schema, sort, items };
    })
    .filter((g) => g.items.length > 0);

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
      </div>

      {rendered.length === 0 ? (
        <p className="object-list__empty">No matches.</p>
      ) : (
        rendered.map((group) => (
          <section className="object-group" key={group.type}>
            <div className="object-group__head">
              <span className="object-group__name">
                {group.type}
                <span className="object-group__count">{group.items.length}</span>
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
                    aria-label={
                      group.sort.dir === 'asc' ? 'Sort ascending' : 'Sort descending'
                    }
                    title={group.sort.dir === 'asc' ? 'Ascending' : 'Descending'}
                  >
                    {group.sort.dir === 'asc' ? '▲' : '▼'}
                  </button>
                </div>
              ) : null}
            </div>

            <ul className="object-list">
              {group.items.map((o) => (
                <li key={o.path}>
                  <button
                    type="button"
                    className={[
                      o.path === selectedPath ? 'is-active' : '',
                      deletedPaths.has(o.path) ? 'is-deleting' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onSelect(o.path)}
                  >
                    <span className="object-list__title">
                      <ChangeBadge
                        state={objectChangeState(
                          o.path,
                          editingPaths,
                          savedPaths,
                          deletedPaths,
                        )}
                      />
                      {objectName(o)}
                    </span>
                    <span className="object-list__type">
                      {o.lang ? (
                        <span className="object-list__lang" title={`Language: ${o.lang}`}>
                          {o.lang}
                        </span>
                      ) : null}
                      {(schemas.get(o.type)?.page ?? true) ? (
                        <VisibilityBadge isPublic={o.public} />
                      ) : null}
                      {secondaryText(o, group.sort)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
