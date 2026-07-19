#!/usr/bin/env node
import { join } from 'node:path';
import { renderPage } from '@timber/generator';
import {
  assembleContent,
  loadSchemas,
  Validator,
  type ContentModel,
} from '@timber/content';
import { NodeFileSource, NodeOutputSink } from './fileSource.node.js';
import { buildSnapshotFromDir } from './snapshot.node.js';
import { buildSite, BuildError } from './build.node.js';
import { importThemeToRepo, parseImportArgs } from './importTheme.node.js';

const USAGE = `timber — Timber static-site generator CLI

Usage:
  timber render <contentDir> <templateFile> <outFile>
  timber validate <repoDir>
  timber build <repoDir> <outDir>
  timber import-theme <themeDir> <repoDir> [--map <type>=<layout> ...]

render   — reads <contentDir>/index.md and <templateFile>, renders the page
           through the shared generator, and writes the HTML to <outFile>.
validate — loads a content repo's schemas + objects, reports invalid objects,
           dangling references, and duplicate ids, and exits non-zero if any.
build    — renders the whole site: every public object through its
           templates/<type>.liquid (fallback templates/default.liquid) into
           <outDir>, copying assets and omitting drafts. Fails (non-zero) if any
           public object is invalid, so a broken site never deploys.
import-theme — adopt-once import of a Jekyll theme (Tier A): transforms its
           _layouts/_includes into native templates/*.liquid, compiles its SCSS,
           and copies its assets into <repoDir>. Use --map <type>=<layout>
           (repeatable) to render a content type through a specific layout, e.g.
           --map posts=post. See docs/importing-jekyll-themes.md.

This is the Node/CI entry point; preview ≡ build.`;

/** Render a single object folder to an HTML file. */
async function renderCommand(
  contentDir: string,
  templateFile: string,
  outFile: string,
): Promise<void> {
  const cwd = process.cwd();
  const source = new NodeFileSource(cwd);
  const sink = new NodeOutputSink(cwd);

  const markdown = await source.readText(join(contentDir, 'index.md'));
  const template = await source.readText(templateFile);

  const html = await renderPage({ markdown, template });

  await sink.writeText(outFile, html);
  process.stdout.write(`Rendered ${join(contentDir, 'index.md')} → ${outFile}\n`);
}

/** Assemble a content repo, report all problems, and return an exit code. */
async function validateCommand(repoDir: string): Promise<number> {
  const snapshot = await buildSnapshotFromDir(repoDir);
  const schemas = loadSchemas(snapshot);
  const model: ContentModel = assembleContent(snapshot, schemas);
  const validator = new Validator(schemas);

  const out = process.stdout;
  let problems = 0;

  // Structural problems that span objects (duplicate id, wrong bundle shape, …).
  for (const err of model.errors) {
    problems += 1;
    out.write(`✗ [${err.kind}] ${err.message}\n`);
  }

  // Per-object field + semantic validation.
  for (const object of [...model.objects].sort((a, b) => a.path.localeCompare(b.path))) {
    const result = validator.validateObject(object, model);
    if (result.valid) {
      out.write(`✓ ${object.path}${object.public ? '' : ' (draft)'}\n`);
    } else {
      problems += result.errors.length;
      out.write(`✗ ${object.path}${object.public ? '' : ' (draft)'}\n`);
      for (const e of result.errors) {
        out.write(`    - ${e.field ? `${e.field}: ` : ''}${e.message}\n`);
      }
    }
  }

  out.write(
    `\n${model.objects.length} object(s), ${schemas.size} type(s), ${problems} problem(s)\n`,
  );
  return problems === 0 ? 0 : 1;
}

/** Build the whole site to <outDir>; returns an exit code (non-zero on build failure). */
async function buildCommand(repoDir: string, outDir: string): Promise<number> {
  try {
    const { pages, drafts, assets, redirects } = await buildSite(repoDir, outDir);
    process.stdout.write(
      `Built ${pages} page(s), ${assets} asset(s), ${redirects} redirect(s), skipped ${drafts} draft(s) → ${outDir}\n`,
    );
    return 0;
  } catch (err) {
    if (err instanceof BuildError) {
      process.stderr.write(`✗ ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

/** Adopt-once import of a Jekyll theme into a Timber repo; returns an exit code. */
async function importThemeCommand(
  themeDir: string,
  repoDir: string,
  typeMap: Record<string, string>,
): Promise<number> {
  const r = await importThemeToRepo(themeDir, repoDir, { typeMap });
  const out = process.stdout;
  const mappedCount = Object.keys(r.mapped).length;
  out.write(
    `Imported ${themeDir} → ${repoDir}\n` +
      `  ${r.templates.length} template(s) (root: ${r.rootLayout}, default: ${r.defaultLayout})\n` +
      `  ${r.assets.length} asset(s) copied (SCSS compiled at build/preview time)\n`,
  );
  if (mappedCount > 0) {
    const pairs = Object.entries(r.mapped)
      .map(([t, l]) => `${t}→${l}`)
      .join(', ');
    out.write(`  ${mappedCount} type(s) wired: ${pairs}\n`);
  }
  out.write(
    `\nContent types without a templates/<type>.liquid render through templates/default.liquid ` +
      `(the theme's ${r.defaultLayout} layout). Wire more with --map <type>=<layout>.\n`,
  );
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return command ? 0 : 1;
  }

  if (command === 'render') {
    const [contentDir, templateFile, outFile] = rest;
    if (!contentDir || !templateFile || !outFile) {
      process.stderr.write(
        `error: render needs <contentDir> <templateFile> <outFile>\n\n${USAGE}\n`,
      );
      return 1;
    }
    await renderCommand(contentDir, templateFile, outFile);
    return 0;
  }

  if (command === 'validate') {
    const [repoDir] = rest;
    if (!repoDir) {
      process.stderr.write(`error: validate needs <repoDir>\n\n${USAGE}\n`);
      return 1;
    }
    return validateCommand(repoDir);
  }

  if (command === 'build') {
    const [repoDir, outDir] = rest;
    if (!repoDir || !outDir) {
      process.stderr.write(`error: build needs <repoDir> <outDir>\n\n${USAGE}\n`);
      return 1;
    }
    return buildCommand(repoDir, outDir);
  }

  if (command === 'import-theme') {
    const { positionals, typeMap } = parseImportArgs(rest);
    const [themeDir, repoDir] = positionals;
    if (!themeDir || !repoDir) {
      process.stderr.write(
        `error: import-theme needs <themeDir> <repoDir>\n\n${USAGE}\n`,
      );
      return 1;
    }
    return importThemeCommand(themeDir, repoDir, typeMap);
  }

  process.stderr.write(`error: unknown command "${command}"\n\n${USAGE}\n`);
  return 1;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
