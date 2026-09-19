import { describe, expect, it } from 'vitest';
import {
  LEGACY_THEME,
  type ContentObject,
  type ContentTypeSchema,
} from '@timber/content';
import type { TreeEntry } from '@timber/host';
import {
  planTypeRename,
  rewriteFrontMatter,
  rewriteReferenceType,
  validateRename,
} from '../src/advanced/renameType.js';

const events: ContentTypeSchema = {
  name: 'events',
  kind: 'collection',
  fields: { title: { type: 'text' }, photo: { type: 'image' } },
};
const people: ContentTypeSchema = {
  name: 'people',
  kind: 'collection',
  fields: {
    title: { type: 'text' },
    event: { type: 'reference', referenceType: 'events' },
  },
};
const settings: ContentTypeSchema = {
  name: 'settings',
  kind: 'singleton',
  page: false,
  fields: {},
};
const schemas = new Map([
  ['events', events],
  ['people', people],
  ['settings', settings],
]);

function obj(
  type: string,
  slug: string,
  data: Record<string, unknown> = {},
  body = '',
): ContentObject {
  const path =
    type === 'settings' ? `content/${type}/index.md` : `content/${type}/${slug}/index.md`;
  return {
    type,
    kind: type === 'settings' ? 'singleton' : 'collection',
    slug,
    path,
    data: { title: slug, ...data },
    body,
    public: true,
  };
}

const fete = obj('events', 'fete', { id: 'e1', photo: 'content/events/fete/photo.webp' });
const gala = obj('events', 'gala', { id: 'e2', aliases: ['ball'] });
const alice = obj('people', 'alice', { id: 'p1', event: 'e1' });
const blog = obj('people', 'blog', { paginate: { collection: 'events', size: 5 } });
const site = obj('settings', 'settings', { title: 'Site' });

const tree: TreeEntry[] = [
  { path: 'content/events/fete/index.md', type: 'blob', sha: 'a' },
  { path: 'content/events/fete/photo.webp', type: 'blob', sha: 'b' },
  { path: 'content/events/gala/index.md', type: 'blob', sha: 'c' },
  { path: 'content/people/alice/index.md', type: 'blob', sha: 'd' },
  { path: 'templates/events.liquid', type: 'blob', sha: 'e' },
  { path: 'themes/other/templates/events.liquid', type: 'blob', sha: 'f' },
  { path: 'themes/other/templates/default.liquid', type: 'blob', sha: 'g' },
];

const eventsYaml = 'kind: collection\nfields:\n  title:\n    type: text\n';
const peopleYaml =
  'kind: collection\nfields:\n  event:\n    type: reference\n    referenceType: events\n';
const advancedFiles = [
  { path: 'config/schemas/events.yml', kind: 'schema', content: eventsYaml },
  { path: 'config/schemas/people.yml', kind: 'schema', content: peopleYaml },
  {
    path: 'templates/events.liquid',
    kind: 'template',
    content: '{% layout "default" %}{{ page.title }}',
  },
  {
    path: 'templates/index.liquid',
    kind: 'template',
    content: '{% for e in collections.events %}{{ e.title }}{% endfor %}',
  },
  {
    path: 'config/navigation.yml',
    kind: 'config',
    content: 'items:\n  - label: Events\n    url: /events/\n',
  },
];

function plan(newName = 'happenings') {
  return planTypeRename({
    oldName: 'events',
    newName,
    schemas,
    objects: [fete, gala, alice, blog, site],
    treeEntries: tree,
    advancedFiles,
    theme: LEGACY_THEME,
  });
}

describe('validateRename', () => {
  const existing = new Set(['events', 'people']);
  it('rejects the current name, collisions and bad slugs', () => {
    expect(validateRename('events', 'events', existing)).toMatch(/current name/);
    expect(validateRename('events', 'people', existing)).toMatch(/already exists/);
    expect(validateRename('events', 'Not Valid', existing)).toMatch(/lowercase/);
  });
  it('accepts a fresh slug-safe name', () => {
    expect(validateRename('events', 'happenings', existing)).toBeNull();
  });
});

describe('rewriteReferenceType', () => {
  it('renames bare and quoted values, leaving other names and comments alone', () => {
    const yaml = [
      'fields:',
      '  a:',
      '    referenceType: events',
      '  b:',
      "    referenceType: 'events' # keep",
      '  c:',
      '    referenceType: events-archive',
      '  d:',
      '    referenceType: people',
    ].join('\n');
    expect(rewriteReferenceType(yaml, 'events', 'happenings').split('\n')).toEqual([
      'fields:',
      '  a:',
      '    referenceType: happenings',
      '  b:',
      "    referenceType: 'happenings' # keep",
      '  c:',
      '    referenceType: events-archive',
      '  d:',
      '    referenceType: people',
    ]);
  });
});

describe('rewriteFrontMatter', () => {
  it('returns the same object when nothing applies', () => {
    const data = { title: 'x' };
    expect(rewriteFrontMatter(data, 'content/a/x', 'content/b/x', 'a', 'b')).toBe(data);
  });
  it('repoints bundle paths, renames a paginate block and appends the alias once', () => {
    const data = {
      photo: 'content/a/x/p.webp',
      paginate: { collection: 'a' },
      aliases: ['/a/x/'],
    };
    expect(
      rewriteFrontMatter(data, 'content/a/x', 'content/b/x', 'a', 'b', '/a/x/'),
    ).toEqual({
      photo: 'content/b/x/p.webp',
      paginate: { collection: 'b' },
      aliases: ['/a/x/'],
    });
  });
});

describe('planTypeRename', () => {
  it('moves the schema file and rewrites referenceType in the others', () => {
    const p = plan();
    expect(p.schema).toEqual({
      from: 'config/schemas/events.yml',
      to: 'config/schemas/happenings.yml',
      content: eventsYaml,
    });
    expect(p.schemaRewrites).toEqual([
      {
        path: 'config/schemas/people.yml',
        content: peopleYaml.replace('events', 'happenings'),
      },
    ]);
  });

  it('moves every bundle of the type with its assets, repointed paths and an absolute-URL alias', () => {
    const p = plan();
    expect(p.objectMoves.map((m) => [m.from, m.to])).toEqual([
      ['content/events/fete/index.md', 'content/happenings/fete/index.md'],
      ['content/events/gala/index.md', 'content/happenings/gala/index.md'],
    ]);
    const [feteMove, galaMove] = p.objectMoves;
    expect(feteMove!.data.photo).toBe('content/happenings/fete/photo.webp');
    expect(feteMove!.data.aliases).toEqual(['/events/fete/']);
    expect(feteMove!.moves).toEqual([
      {
        from: 'content/events/fete/photo.webp',
        to: 'content/happenings/fete/photo.webp',
        sha: 'b',
      },
    ]);
    // An existing slug alias is kept and the URL alias appended after it.
    expect(galaMove!.data.aliases).toEqual(['ball', '/events/gala/']);
    expect(galaMove!.moves).toEqual([]);
  });

  it('skips objects marked for deletion', () => {
    const p = planTypeRename({
      oldName: 'events',
      newName: 'happenings',
      schemas,
      objects: [fete, gala],
      deletedPaths: new Set([gala.path]),
      treeEntries: tree,
      advancedFiles,
      theme: LEGACY_THEME,
    });
    expect(p.objectMoves.map((m) => m.from)).toEqual([fete.path]);
  });

  it('rewrites paginate blocks on other types and leaves untouched objects alone', () => {
    const p = plan();
    expect(p.objectRewrites).toEqual([
      {
        object: blog,
        data: { ...blog.data, paginate: { collection: 'happenings', size: 5 } },
      },
    ]);
  });

  it('renames the active theme template by text and other themes’ by SHA', () => {
    const p = plan();
    expect(p.templateMoves).toEqual([
      {
        from: 'templates/events.liquid',
        to: 'templates/happenings.liquid',
        content: '{% layout "default" %}{{ page.title }}',
      },
    ]);
    expect(p.templateShaMoves).toEqual([
      {
        from: 'themes/other/templates/events.liquid',
        to: 'themes/other/templates/happenings.liquid',
        sha: 'f',
      },
    ]);
  });

  it('warns about mentions it will not rewrite', () => {
    const p = plan();
    expect(p.warnings).toEqual([
      expect.stringContaining('templates/index.liquid loops over collections.events'),
      expect.stringContaining('config/navigation.yml contains a /events/ URL'),
    ]);
  });

  it('warns about pages that link to the old URLs', () => {
    const p = planTypeRename({
      oldName: 'events',
      newName: 'happenings',
      schemas,
      objects: [fete, obj('people', 'bob', {}, 'See [the fete](/events/fete/).')],
      treeEntries: [],
      advancedFiles: [
        { path: 'config/schemas/events.yml', kind: 'schema', content: eventsYaml },
      ],
      theme: LEGACY_THEME,
    });
    expect(p.warnings).toEqual([
      expect.stringContaining('One page links to /events/… (bob)'),
    ]);
  });

  it('gives a non-page type no alias (it has no URL to redirect)', () => {
    const p = planTypeRename({
      oldName: 'settings',
      newName: 'site',
      schemas,
      objects: [site],
      treeEntries: [],
      advancedFiles: [
        {
          path: 'config/schemas/settings.yml',
          kind: 'schema',
          content: 'kind: singleton\npage: false\n',
        },
      ],
      theme: LEGACY_THEME,
    });
    expect(p.objectMoves).toEqual([
      expect.objectContaining({
        from: 'content/settings/index.md',
        to: 'content/site/index.md',
        data: { title: 'Site' },
      }),
    ]);
  });

  it('refuses an invalid new name', () => {
    expect(() => plan('people')).toThrow(/already exists/);
  });
});
