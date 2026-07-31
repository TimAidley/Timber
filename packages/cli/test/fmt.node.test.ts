import { cp, mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { formatRepo } from '../src/fmt.node.js';
import { buildSite } from '../src/build.node.js';

const here = dirname(fileURLToPath(import.meta.url));
const siteFixture = join(here, 'fixtures', 'site');

/** Write a content object at `content/<type>/<slug>/index.md` with raw bytes. */
async function writeObject(repo: string, rel: string, raw: string): Promise<string> {
  const path = join(repo, 'content', rel, 'index.md');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, raw, 'utf8');
  return path;
}

describe('formatRepo', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'timber-fmt-'));
  });

  it('reports a non-canonical object without touching it when write is false', async () => {
    // No blank line after the closing fence — the shape a hand-authored body-less
    // object takes, and the one that makes the editor show it as modified on load.
    const raw = '---\ntitle: Home\n---\n';
    const path = await writeObject(repo, 'pages/home', raw);

    const result = await formatRepo(repo, { write: false });

    expect(result.changed).toEqual(['content/pages/home/index.md']);
    expect(result.checked).toBe(1);
    expect(await readFile(path, 'utf8')).toBe(raw); // untouched
  });

  it('rewrites the object into canonical form when write is true', async () => {
    const path = await writeObject(repo, 'pages/home', '---\ntitle: Home\n---\n');

    const result = await formatRepo(repo, { write: true });

    expect(result.changed).toEqual(['content/pages/home/index.md']);
    expect(await readFile(path, 'utf8')).toBe('---\ntitle: Home\n---\n\n');
  });

  it('reports nothing on a second run — the fix is stable', async () => {
    await writeObject(repo, 'pages/home', '---\ntitle: Home\n---\n');
    await formatRepo(repo, { write: true });

    expect((await formatRepo(repo, { write: false })).changed).toEqual([]);
  });

  it('leaves an already-canonical repo alone', async () => {
    // The shipped fixture site is the reference for "what good looks like".
    expect((await formatRepo(siteFixture, { write: false })).changed).toEqual([]);
  });

  it('does not change what the site renders', async () => {
    // Formatting is cosmetic by construction, and that is the whole basis for enforcing
    // it in CI: de-normalise every object in a real site, format it back, and the built
    // HTML must be byte-identical to the pristine build.
    const pristineOut = await mkdtemp(join(tmpdir(), 'timber-fmt-out-'));
    const formattedOut = await mkdtemp(join(tmpdir(), 'timber-fmt-out-'));
    const copy = await mkdtemp(join(tmpdir(), 'timber-fmt-copy-'));

    await cp(siteFixture, copy, { recursive: true });
    await buildSite(siteFixture, pristineOut);

    // Collapse the blank separator line on every object — valid, but not canonical.
    const objects = (await formatRepo(copy, { write: false })).checked;
    expect(objects).toBeGreaterThan(0);
    for (const rel of await objectPaths(copy)) {
      const raw = await readFile(join(copy, rel), 'utf8');
      await writeFile(join(copy, rel), raw.replace(/---\n\n/, '---\n'), 'utf8');
    }
    expect((await formatRepo(copy, { write: false })).changed.length).toBeGreaterThan(0);

    await formatRepo(copy, { write: true });
    await buildSite(copy, formattedOut);

    expect(await treeOf(formattedOut)).toEqual(await treeOf(pristineOut));
  });
});

/** Every `content/**\/index.md` under `repo`, repo-relative and sorted. */
async function objectPaths(repo: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else if (entry.name === 'index.md') out.push(relative(repo, abs).split(sep).join('/'));
    }
  };
  await walk(join(repo, 'content'));
  return out.sort();
}

/** A directory's full contents as path → bytes, for byte-exact comparison. */
async function treeOf(dir: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {};
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else tree[relative(dir, abs).split(sep).join('/')] = await readFile(abs, 'base64');
    }
  };
  await walk(dir);
  return tree;
}
