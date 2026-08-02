#!/usr/bin/env node
// Writes the Timber wordmark's <style> block into docs/install.html, between the
// `wordmark:start` / `wordmark:end` markers, from the generator's canonical
// WORDMARK_CSS (SPEC §7 → Brand wordmark).
//
// docs/install.html is a standalone page — it never passes through the generator, so
// injectWordmarkStyle() can't reach it and it has to carry its own copy. Copying by
// hand would make it the third place the brand styling lives and the first to go
// stale, which is exactly what WORDMARK_CSS exists to prevent. Run this instead:
//   pnpm --filter @timber/generator build && node scripts/gen-install-wordmark.mjs
// test/install-page.test.ts fails if the two ever drift apart.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const built = join(root, 'packages/generator/dist/wordmarkStyle.js');
const page = join(root, 'docs/install.html');

const START = '<!-- wordmark:start -->';
const END = '<!-- wordmark:end -->';

let WORDMARK_CSS;
try {
  ({ WORDMARK_CSS } = await import(built));
} catch {
  console.error(
    `Can't read ${built}.\nBuild the generator first: pnpm --filter @timber/generator build`,
  );
  process.exit(1);
}

const html = readFileSync(page, 'utf8');
const from = html.indexOf(START);
const to = html.indexOf(END);
if (from === -1 || to === -1 || to < from) {
  console.error(`${page} is missing its ${START} / ${END} markers.`);
  process.exit(1);
}

const block = `${START}\n<style>${WORDMARK_CSS}</style>\n`;
const updated = html.slice(0, from) + block + html.slice(to);
writeFileSync(page, updated);
console.log(
  `Wrote the wordmark block into ${page} (${WORDMARK_CSS.length} chars of CSS)`,
);
