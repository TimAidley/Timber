#!/usr/bin/env node
import { join } from 'node:path';
import { renderPage } from '@timber/generator';
import { NodeFileSource, NodeOutputSink } from './fileSource.node.js';

const USAGE = `timber — Timber static-site generator CLI

Usage:
  timber render <contentDir> <templateFile> <outFile>

Reads <contentDir>/index.md and <templateFile>, renders the page through the
shared generator (the same code the browser uses for preview), and writes the
HTML to <outFile>. This is the Node/CI entry point; preview ≡ build.`;

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
