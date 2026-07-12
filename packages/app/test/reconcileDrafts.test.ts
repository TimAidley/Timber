import { describe, expect, it } from 'vitest';
import { reconcileAdvancedDrafts } from '../src/advanced/reconcileDrafts.js';
import type { AdvancedFile } from '../src/advanced/loadAdvancedFiles.js';

const pagesSchema: AdvancedFile = {
  path: 'config/schemas/pages.yml',
  kind: 'schema',
  content: 'kind: collection\nfields:\n  title:\n    type: text\n',
};
const template: AdvancedFile = {
  path: 'templates/default.liquid',
  kind: 'template',
  content: '<h1>{{ page.title }}</h1>',
};

describe('reconcileAdvancedDrafts', () => {
  it('leaves loaded files untouched when there are no drafts', () => {
    const { files, text, requeue } = reconcileAdvancedDrafts([template, pagesSchema], []);
    expect(files).toEqual([template, pagesSchema]);
    expect(text.get(pagesSchema.path)).toBe(pagesSchema.content);
    expect(requeue).toEqual([]);
  });

  it('overrides a loaded file with a differing draft and re-queues it when valid', () => {
    const edited = 'kind: collection\nhasBody: true\nfields:\n  title:\n    type: text\n';
    const { text, requeue } = reconcileAdvancedDrafts(
      [pagesSchema],
      [{ path: pagesSchema.path, body: edited }],
    );
    expect(text.get(pagesSchema.path)).toBe(edited);
    expect(requeue).toEqual([{ path: pagesSchema.path, content: edited }]);
  });

  it('does not re-queue a draft that is invalid (kept as working text only)', () => {
    const broken = 'kind: collection\nfields:\n  title:\n    type: nonsense\n';
    const { text, requeue } = reconcileAdvancedDrafts(
      [pagesSchema],
      [{ path: pagesSchema.path, body: broken }],
    );
    expect(text.get(pagesSchema.path)).toBe(broken); // shown, so nothing is lost
    expect(requeue).toEqual([]); // but never committed
  });

  it('ignores a draft identical to the loaded file', () => {
    const { requeue } = reconcileAdvancedDrafts(
      [pagesSchema],
      [{ path: pagesSchema.path, body: pagesSchema.content }],
    );
    expect(requeue).toEqual([]);
  });

  it('resurrects a draft for a schema not in the loaded tree (a new, uncommitted type)', () => {
    const newType =
      'kind: collection\nhasBody: true\nfields:\n  title:\n    type: text\n    required: true\n';
    const { files, text, requeue } = reconcileAdvancedDrafts(
      [pagesSchema],
      [{ path: 'config/schemas/events.yml', body: newType }],
    );
    const events = files.find((f) => f.path === 'config/schemas/events.yml');
    expect(events).toMatchObject({ kind: 'schema', content: newType });
    expect(text.get('config/schemas/events.yml')).toBe(newType);
    expect(requeue).toContainEqual({
      path: 'config/schemas/events.yml',
      content: newType,
    });
  });

  it('keeps the file list sorted templates → schemas → config after resurrecting', () => {
    const newType = 'kind: singleton\npage: false\nfields:\n  title:\n    type: text\n';
    const { files } = reconcileAdvancedDrafts(
      [template, pagesSchema],
      [{ path: 'config/schemas/authors.yml', body: newType }],
    );
    expect(files.map((f) => f.path)).toEqual([
      'templates/default.liquid',
      'config/schemas/authors.yml',
      'config/schemas/pages.yml',
    ]);
  });

  it('ignores content-object drafts (only advanced-area paths resurface)', () => {
    const { files, requeue } = reconcileAdvancedDrafts(
      [pagesSchema],
      [{ path: 'content/pages/hello/index.md', body: '# Hello' }],
    );
    expect(files).toEqual([pagesSchema]); // content draft not added to the file list
    expect(requeue).toEqual([]);
  });
});
