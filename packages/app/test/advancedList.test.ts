import { describe, expect, it } from 'vitest';
import { advancedFileName, groupAdvancedFiles } from '../src/advanced/advancedList.js';
import type { AdvancedFile } from '../src/advanced/loadAdvancedFiles.js';

function file(path: string, kind: AdvancedFile['kind']): AdvancedFile {
  return { path, kind, content: '' };
}

describe('groupAdvancedFiles', () => {
  it('groups files by kind in a stable heading order (templates → schemas → config)', () => {
    const files = [
      file('config/navigation.yml', 'config'),
      file('config/schemas/pages.yml', 'schema'),
      file('templates/default.liquid', 'template'),
      file('config/schemas/settings.yml', 'schema'),
    ];
    const groups = groupAdvancedFiles(files);
    expect(groups.map((g) => g.kind)).toEqual(['template', 'schema', 'config']);
    expect(groups.map((g) => g.label)).toEqual(['Templates', 'Schemas', 'Config']);
    expect(groups.map((g) => g.files.length)).toEqual([1, 2, 1]);
  });

  it('preserves the incoming file order within a group', () => {
    const files = [
      file('config/schemas/pages.yml', 'schema'),
      file('config/schemas/settings.yml', 'schema'),
    ];
    const [schemas] = groupAdvancedFiles(files);
    expect(schemas?.files.map((f) => f.path)).toEqual([
      'config/schemas/pages.yml',
      'config/schemas/settings.yml',
    ]);
  });

  it('drops kinds with no files', () => {
    const groups = groupAdvancedFiles([file('templates/default.liquid', 'template')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe('template');
  });

  it('returns nothing for an empty list', () => {
    expect(groupAdvancedFiles([])).toEqual([]);
  });
});

describe('advancedFileName', () => {
  it('shows the basename of the path', () => {
    expect(advancedFileName(file('config/schemas/pages.yml', 'schema'))).toBe('pages.yml');
    expect(advancedFileName(file('templates/default.liquid', 'template'))).toBe(
      'default.liquid',
    );
  });
});
