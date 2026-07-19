import type { Liquid } from 'liquidjs';

/**
 * The Jekyll plugin *tags* Timber themes call — mapped onto data Timber already computes,
 * so a theme's `{%- seo -%}` / `{%- feed_meta -%}` call sites are unchanged.
 *
 * `{% seo %}` (jekyll-seo-tag) emits `<head>` metadata from Timber's computed `seo` bag
 * (SPEC §13); `{% feed_meta %}` (jekyll-feed) is a documented no-op since Timber defers RSS
 * (SPEC §7). A tag writes raw HTML to the emitter, so values are escaped here explicitly.
 */

/** The slice of the LiquidJS render context these tags read. */
interface RenderContext {
  getSync(path: PropertyKey[]): unknown;
}
/** The slice of the LiquidJS emitter these tags write to. */
interface Emitter {
  write(html: string): void;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' })[c]!,
  );
}

function str(ctx: RenderContext, path: PropertyKey[]): string {
  const value = ctx.getSync(path);
  return typeof value === 'string' ? value : '';
}

/** Register `{% seo %}` and `{% feed_meta %}` on a LiquidJS engine. */
export function registerJekyllTags(engine: Liquid): void {
  engine.registerTag('seo', {
    parse() {},
    render(ctx: RenderContext, emitter: Emitter) {
      const title = str(ctx, ['seo', 'title']) || str(ctx, ['site', 'title']);
      const description = str(ctx, ['seo', 'description']);
      const canonical = str(ctx, ['seo', 'canonical']);
      const ogTitle = str(ctx, ['seo', 'ogTitle']) || title;
      const ogDescription = str(ctx, ['seo', 'ogDescription']);
      const ogType = str(ctx, ['seo', 'ogType']) || 'website';
      const ogImage = str(ctx, ['seo', 'ogImage']);
      const lines = [
        `<title>${esc(title)}</title>`,
        description ? `<meta name="description" content="${esc(description)}">` : '',
        canonical ? `<link rel="canonical" href="${esc(canonical)}">` : '',
        `<meta property="og:title" content="${esc(ogTitle)}">`,
        ogDescription
          ? `<meta property="og:description" content="${esc(ogDescription)}">`
          : '',
        `<meta property="og:type" content="${esc(ogType)}">`,
        ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : '',
      ].filter(Boolean);
      emitter.write(lines.join('\n  '));
    },
  });

  engine.registerTag('feed_meta', {
    parse() {},
    render(_ctx: RenderContext, emitter: Emitter) {
      emitter.write('<!-- feed_meta: RSS deferred in Timber v1 -->');
    },
  });
}
