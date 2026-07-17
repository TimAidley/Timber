import type { FrontMatter } from '@timber/generator';

/**
 * Settings-driven theme options (SPEC §13): a few colour/font/layout knobs on the global
 * settings singleton that override the default theme's CSS custom properties. The design
 * keeps templates dumb — this computes a validated `:root { … }` override block in the
 * generator, exposed as `{{ site.themeStyle }}`, which the default template drops into a
 * `<style>` after `theme.css`. Because those overrides land in the document `<head>`,
 * **every value is validated here** before it reaches CSS: colours must be hex, fonts and
 * widths are chosen from fixed maps — nothing author-supplied is interpolated raw.
 *
 * Unset or unrecognised values are simply skipped, so the theme's own defaults show
 * through; an all-empty settings block yields `''` (the template then emits no `<style>`).
 */

/** The settings keys this reads, mapped to the CSS variable each drives. */
const COLOR_VARS: Record<string, string> = {
  accentColor: '--accent',
  textColor: '--fg',
  backgroundColor: '--bg',
};

/** Font enum value → a fixed, known-safe font stack. */
const FONT_STACKS: Record<string, string> = {
  serif: "'Source Serif 4', Georgia, 'Times New Roman', serif",
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

/** Content-width enum value → a fixed max-width. */
const WIDTHS: Record<string, string> = {
  narrow: '34rem',
  normal: '44rem',
  wide: '60rem',
};

const FONT_VARS: Record<string, Record<string, string>> = {
  bodyFont: FONT_STACKS,
  headingFont: FONT_STACKS,
};

/** Accept `#rgb`, `#rrggbb`, or `#rrggbbaa` only — the picker emits `#rrggbb`. */
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Build the `:root { … }` CSS override block from the settings front matter, or `''`
 * when no valid knob is set. Each declaration is emitted only for a value that passes
 * its check — a bad colour or an unknown enum value is dropped, never interpolated.
 */
export function themeStyle(settings: FrontMatter): string {
  const decls: string[] = [];

  for (const [key, cssVar] of Object.entries(COLOR_VARS)) {
    const value = str(settings[key]);
    if (value && HEX.test(value)) decls.push(`${cssVar}: ${value};`);
  }
  for (const [key, table] of Object.entries(FONT_VARS)) {
    const stack = table[str(settings[key]) ?? ''];
    if (stack) decls.push(`--font-${key === 'bodyFont' ? 'body' : 'heading'}: ${stack};`);
  }
  const width = WIDTHS[str(settings.contentWidth) ?? ''];
  if (width) decls.push(`--maxw: ${width};`);

  return decls.length ? `:root { ${decls.join(' ')} }` : '';
}
