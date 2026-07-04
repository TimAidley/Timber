import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  assembleContent,
  canPublish,
  detectDanglingReferences,
  loadSchemas,
  parseVideoUrl,
  urlFor,
  Validator,
  type ContentModel,
  type ContentObject,
  type RepoSnapshot,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, 'fixtures', 'repo');

/** Walk the fixture repo into a RepoSnapshot (repo-relative posix paths → text). */
function buildSnapshot(root: string): RepoSnapshot {
  const snapshot: RepoSnapshot = new Map();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else {
        const rel = relative(root, abs).split(sep).join('/');
        snapshot.set(rel, readFileSync(abs, 'utf8'));
      }
    }
  };
  walk(root);
  return snapshot;
}

let model: ContentModel;
let validator: Validator;

function objectAt(path: string): ContentObject {
  const obj = model.objects.find((o) => o.path === path);
  if (!obj) throw new Error(`no object at ${path}`);
  return obj;
}

beforeAll(() => {
  const snapshot = buildSnapshot(repoRoot);
  const schemas = loadSchemas(snapshot);
  model = assembleContent(snapshot, schemas);
  validator = new Validator(schemas);
});

describe('loadSchemas', () => {
  it('loads collection and singleton schemas keyed by type name', () => {
    expect([...model.schemas.keys()].sort()).toEqual(['events', 'people', 'site-settings']);
    expect(model.schemas.get('events')?.kind).toBe('collection');
    const settings = model.schemas.get('site-settings');
    expect(settings?.kind).toBe('singleton');
    expect(settings?.hasBody).toBe(false);
  });
});

describe('assembleContent', () => {
  it('builds the id index over uniquely-identified objects', () => {
    expect(model.byId.get('PERSON-JANE')?.type).toBe('people');
    expect(model.byId.get('EVENT-FETE')?.slug).toBe('summer-fete');
    // The duplicate id resolves to the first-seen object, not the second.
    expect(model.byId.get('EVENT-DUP')?.path).toContain('dup-a');
  });

  it('flags a duplicate id as a model error naming both paths', () => {
    const dupes = model.errors.filter((e) => e.kind === 'duplicate-id');
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.paths.some((p) => p.includes('dup-a'))).toBe(true);
    expect(dupes[0]?.paths.some((p) => p.includes('dup-b'))).toBe(true);
  });

  it('treats a singleton as a bundle without a slug subfolder, and honors hasBody:false', () => {
    const settings = objectAt('content/site-settings/index.md');
    expect(settings.kind).toBe('singleton');
    expect(settings.slug).toBe('site-settings');
    expect(settings.body).toBe('');
  });

  it('is draft by default when the public key is absent', () => {
    expect(objectAt('content/events/draft-event/index.md').public).toBe(false);
    expect(objectAt('content/events/summer-fete/index.md').public).toBe(true);
  });

  it('preserves undeclared front-matter keys (tolerant model)', () => {
    expect(objectAt('content/events/summer-fete/index.md').data.customNote).toContain(
      'tolerant',
    );
  });
});

describe('Validator', () => {
  it('passes a fully valid object, undeclared keys and all', () => {
    const result = validator.validateObject(
      objectAt('content/events/summer-fete/index.md'),
      model,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('catches required/enum/range/format errors on a broken object', () => {
    const result = validator.validateObject(
      objectAt('content/events/broken-event/index.md'),
      model,
    );
    expect(result.valid).toBe(false);
    const blob = result.errors.map((e) => `${e.field ?? ''} ${e.message}`).join('\n');
    expect(blob).toMatch(/title/); // required missing
    expect(blob).toMatch(/enum|category/); // bad enum
    expect(blob).toMatch(/capacity/); // out of range
    expect(blob).toMatch(/video/); // disallowed provider
  });

  it('rejects a dangling reference', () => {
    const result = validator.validateObject(
      objectAt('content/events/dangling-ref/index.md'),
      model,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /does not resolve/.test(e.message))).toBe(true);
  });

  it('rejects a reference pointing at the wrong content type', () => {
    const result = validator.validateObject(
      objectAt('content/events/wrong-type-ref/index.md'),
      model,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /expected "people"/.test(e.message))).toBe(true);
  });

  it('treats a valid draft as publishable-if-published, but still private', () => {
    const draft = objectAt('content/events/draft-event/index.md');
    const result = validator.validateObject(draft, model);
    expect(result.valid).toBe(true);
    expect(canPublish(result)).toBe(true); // it validates, so it *could* be made public
    expect(draft.public).toBe(false); // but it isn't
  });

  it('blocks an invalid object from being publishable', () => {
    const result = validator.validateObject(
      objectAt('content/events/broken-event/index.md'),
      model,
    );
    expect(canPublish(result)).toBe(false);
  });
});

describe('references', () => {
  it('detects every dangling / wrong-type reference across the model', () => {
    const dangling = detectDanglingReferences(model);
    expect(dangling.some((e) => e.message.includes('PERSON-NOBODY'))).toBe(true);
    expect(dangling.some((e) => e.message.includes('expected "people"'))).toBe(true);
    expect(dangling).toHaveLength(2);
  });

  it('builds a default URL from type and slug', () => {
    const fete = objectAt('content/events/summer-fete/index.md');
    expect(urlFor(fete, model.schemas.get('events')!)).toBe('/events/summer-fete/');
  });
});

describe('parseVideoUrl', () => {
  it('accepts allow-listed providers and extracts the id', () => {
    expect(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      provider: 'youtube',
      id: 'dQw4w9WgXcQ',
    });
    expect(parseVideoUrl('https://youtu.be/abc123')).toEqual({
      provider: 'youtube',
      id: 'abc123',
    });
    expect(parseVideoUrl('https://vimeo.com/123456789')).toEqual({
      provider: 'vimeo',
      id: '123456789',
    });
  });

  it('rejects non-allow-listed hosts and malformed URLs', () => {
    expect(parseVideoUrl('https://evil.example.com/embed/xyz')).toBeUndefined();
    expect(parseVideoUrl('not a url')).toBeUndefined();
  });
});
