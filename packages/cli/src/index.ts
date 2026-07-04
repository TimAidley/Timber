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

const USAGE = `timber — Timber static-site generator CLI

Usage:
  timber render <contentDir> <templateFile> <outFile>
  timber validate <repoDir>

render   — reads <contentDir>/index.md and <templateFile>, renders the page
           through the shared generator, and writes the HTML to <outFile>.
validate — loads a content repo's schemas + objects, reports invalid objects,
           dangling references, and duplicate ids, and exits non-zero if any.

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

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return command ? 0 : 1;
  }

  if (command === 'render') {
    const [contentDir, templateFile, outFile] = rest;
    if (!contentDir || !templateFile || !outFile) {
      process.stderr.write(`error: render needs <contentDir> <templateFile> <outFile>\n\n${USAGE}\n`);
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
