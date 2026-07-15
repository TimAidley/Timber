/**
 * Helpers for **creating a new template or config file** from the advanced area
 * (SPEC §8). The advanced area is the same edit-preview-commit loop pointed at the
 * site's `templates/*.liquid` and `config/*.yml` files — but until now the only
 * *create* affordance was "New type" (a `config/schemas/<name>.yml`). A site owner
 * customizing the theme needs to add a **template** (e.g. `templates/events.liquid`
 * to style one content type) or a plain **config** file too. These are the pure bits
 * (path + name validation + starter content) kept out of the React dialog so they're
 * unit-testable, mirroring `schemaTemplate.ts`.
 */

export type NewFileKind = 'template' | 'style' | 'config';

export interface NewFileOptions {
  kind: NewFileKind;
  /** The base name — no directory, no extension (the kind supplies both). */
  name: string;
}

/** File names double as path segments, so keep them slug-safe (same shape as types). */
const NAME_RE = /^[a-z][a-z0-9-]*$/;

/** Repo path for a new file of the given kind. */
export function newFilePath(opts: NewFileOptions): string {
  switch (opts.kind) {
    case 'template':
      return `templates/${opts.name}.liquid`;
    case 'style':
      return `assets/${opts.name}.css`;
    case 'config':
      return `config/${opts.name}.yml`;
  }
}

/**
 * Validate a proposed file name, returning a human-readable error or `null` when it's
 * usable. Guards the slug shape and rejects a name whose resulting path already exists
 * (so a new template can't clobber `default.liquid`, nor a config file an existing one).
 */
export function validateFileName(
  kind: NewFileKind,
  name: string,
  existingPaths: ReadonlySet<string>,
): string | null {
  const n = name.trim();
  if (!n) return 'Enter a file name.';
  if (!NAME_RE.test(n)) {
    return 'Use lowercase letters, numbers and hyphens, starting with a letter — e.g. “events”.';
  }
  if (existingPaths.has(newFilePath({ kind, name: n }))) {
    return `${newFilePath({ kind, name: n })} already exists.`;
  }
  return null;
}

/**
 * Generate **starter content** for a new file so it's immediately valid (it flows
 * straight into the shared WIP commit) and shows the author what to edit.
 *
 * - `template` → a minimal but complete Liquid page. A template named after a content
 *   type (e.g. `events`) renders that type's pages **instead of** `default.liquid`
 *   (see the CLI's `resolveTemplate`), so the header comment points that out and names
 *   the render context the generator exposes.
 * - `style` → a commented CSS stub. It's copied verbatim to the built site, but a
 *   template only picks it up if you `<link>` it (unlike `assets/theme.css`, which the
 *   default templates already link), so the header says so.
 * - `config` → a commented-out YAML stub (an empty doc parses fine); the author fills
 *   in the structured data their templates read.
 */
export function buildStarterFile(opts: NewFileOptions): string {
  if (opts.kind === 'style') {
    return [
      `/* “${opts.name}” stylesheet — copied as-is to /assets on build.`,
      `   Reference it from a template with:`,
      `   <link rel="stylesheet" href="{{ site.basePath }}/assets/${opts.name}.css" /> */`,
      ``,
    ].join('\n');
  }
  if (opts.kind === 'template') {
    return [
      `{% comment %}`,
      `  “${opts.name}” template. Named after a content type (events, people…), this`,
      `  renders that type’s pages instead of templates/default.liquid. Context available:`,
      `  page (this object’s fields), content (its rendered body), site, seo, collections.`,
      `{% endcomment %}`,
      `<!doctype html>`,
      `<html lang="en">`,
      `  <head>`,
      `    <meta charset="utf-8" />`,
      `    <meta name="viewport" content="width=device-width, initial-scale=1" />`,
      `    <title>{{ seo.title }}</title>`,
      `    <link rel="stylesheet" href="{{ site.basePath }}/assets/theme.css" />`,
      `  </head>`,
      `  <body>`,
      `    <main>`,
      `      <h1>{{ page.title }}</h1>`,
      `      {{ content }}`,
      `    </main>`,
      `  </body>`,
      `</html>`,
      ``,
    ].join('\n');
  }
  return [
    `# “${opts.name}” config — structured data your templates can read.`,
    `# Add YAML keys below.`,
    ``,
  ].join('\n');
}
