import { renderPage, type FrontMatter } from '@timber/generator';
import {
  assembleCollections,
  siteContext,
  pageSeo,
  loadNavigation,
  urlFor,
  type ContentModel,
  type ContentObject,
  type ContentTypeSchema,
  type RepoSnapshot,
  type SiteContext,
} from '@timber/content';
import { reassembleDocument } from '../content/document.js';
import type { AssetStore } from '../state/assets.js';
import type { SiteTheme } from './siteTheme.js';

/** Content/site asset references the preview should resolve to loadable object URLs. */
const ASSET_REF_RE = /(?:src|href)="([^"]+\.(?:webp|png|jpe?g|gif|svg|avif))"/gi;
/** The `<link>` to the theme stylesheet that the build serves from `/assets/` — there's
 *  no server behind the preview, so we swap it for an inline `<style>`. */
const THEME_LINK_RE = /<link\b[^>]*href="[^"]*assets\/theme\.css"[^>]*>/i;

export interface RenderSitePageInput {
  /** The working content model (schemas + id index), for `{{ site }}` + nav resolution. */
  model: ContentModel;
  /** The object being edited — supplies type (→ template), id, and slug (→ URL). */
  object: ContentObject;
  schema: ContentTypeSchema;
  /** Live edits (may differ from `object.data`/body): what the author sees right now. */
  data: FrontMatter;
  body: string;
  theme: SiteTheme;
  assetStore: AssetStore;
}

/**
 * Render the edited page through the site's *own* template + theme, returning a full HTML
 * document ready for the sandboxed preview frame. This mirrors the CLI build's context
 * assembly (`build.node.ts`) — same `siteContext`/`loadNavigation`/`pageSeo`/`urlFor`
 * helpers, same `<type>.liquid → default.liquid` template resolution — so preview ≡ build
 * (SPEC §6). Post-render it inlines the theme CSS and rewrites asset paths to object URLs,
 * since the frame can't reach the repo over the network.
 */
export async function renderSitePage(input: RenderSitePageInput): Promise<string> {
  const { model, object, schema, data, body, theme, assetStore } = input;

  const template =
    theme.templates.get(`${object.type}.liquid`) ?? theme.templates.get('default.liquid');
  if (!template) {
    throw new Error(
      `No template for type "${object.type}". Add templates/${object.type}.liquid or templates/default.liquid to the site.`,
    );
  }

  // Site-wide context from the settings singleton (the `page: false` type), exactly as
  // the build derives it — including homepage-at-root and manual navigation (SPEC §13).
  const settings = model.objects.find((o) => model.schemas.get(o.type)?.page === false);
  const site: SiteContext = siteContext(settings);
  const homepageId = typeof site.homepage === 'string' ? site.homepage : undefined;
  const effectiveUrl = (o: ContentObject, s: ContentTypeSchema): string =>
    homepageId && o.id === homepageId ? '/' : urlFor(o, s);
  const navSnapshot: RepoSnapshot = new Map(
    theme.navigationYml ? [['config/navigation.yml', theme.navigationYml]] : [],
  );
  site.nav = loadNavigation(navSnapshot, (id) => {
    const target = model.byId.get(id);
    const targetSchema = target && model.schemas.get(target.type);
    return target && targetSchema ? effectiveUrl(target, targetSchema) : undefined;
  });

  // Per-type collections for listing loops (SPEC §6), assembled exactly as the CLI build
  // does — same `effectiveUrl`, same @timber/content helper — so preview ≡ build.
  const collections = assembleCollections(model, effectiveUrl);

  // Preview the *live* edits: SEO (title/description) and URL reflect the current form.
  const liveObject: ContentObject = { ...object, data };
  const seo = pageSeo(liveObject, schema, site);

  let html = await renderPage({
    markdown: reassembleDocument(data, body),
    template,
    site,
    collections,
    seo,
  });

  // Inline the theme stylesheet in place of its (unreachable) `<link>`.
  if (theme.css) {
    const style = `<style data-timber-theme>${theme.css}</style>`;
    if (THEME_LINK_RE.test(html)) html = html.replace(THEME_LINK_RE, style);
    else if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, `${style}</head>`);
    else html = style + html;
  }

  // Resolve committed/staged image paths to object URLs the frame can load.
  const paths = new Set<string>();
  for (const match of html.matchAll(ASSET_REF_RE)) {
    const path = match[1];
    if (path && /^(content|assets)\//.test(path)) paths.add(path);
  }
  const resolved = new Map<string, string>();
  await Promise.all(
    [...paths].map(async (path) => {
      const url = await assetStore.ensure(path);
      if (url) resolved.set(path, url);
    }),
  );
  for (const [path, url] of resolved) html = html.split(`"${path}"`).join(`"${url}"`);

  return html;
}
