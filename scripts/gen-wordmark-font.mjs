#!/usr/bin/env node
// Regenerates packages/generator/src/wordmarkFont.ts from the canonical subsetted
// Fraunces logo face. The `:timber-logo` shortcode (SPEC §7 → Brand wordmark) embeds
// this font base64 so the wordmark renders self-contained on ANY Timber site — no
// dependency on the site theme shipping the font. Run after changing the woff2:
//   node scripts/gen-wordmark-font.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'packages/app/src/fonts/fraunces-timber.woff2');
const out = join(root, 'packages/generator/src/wordmarkFont.ts');

const base64 = readFileSync(src).toString('base64');
const contents =
  `// AUTO-GENERATED — do not edit by hand.\n` +
  `// The subsetted Fraunces logo face (glyphs "Timber", OFL-1.1), base64-embedded so the\n` +
  `// \`:timber-logo\` shortcode (SPEC §7 → Brand wordmark) is fully self-contained: the\n` +
  `// wordmark renders with its exact font on ANY Timber site, with no dependency on the\n` +
  `// site theme shipping the font or the \`.wordmark\` rules. Regenerate from the canonical\n` +
  `// woff2 (packages/app/src/fonts/fraunces-timber.woff2) with scripts/gen-wordmark-font.mjs.\n` +
  `\n` +
  `export const WORDMARK_FONT_DATA_URI =\n  'data:font/woff2;base64,${base64}';\n`;

writeFileSync(out, contents);
console.log(`Wrote ${out} (${base64.length} base64 chars from ${src})`);
