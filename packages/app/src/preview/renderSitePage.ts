import { renderPage, buildClock, type FrontMatter } from '@timber/generator';
import { themeRuntime } from '@timber/eleventy-compat';
import {
  assembleCollections,
  siteContext,
  pageSeo,
  hreflangAlternates,
  loadNavigation,
  translationsOf,
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
import { bareNameTemplates } from './templateMap.js';

/** Content/site asset references the preview should resolve to loadable object URLs. */
const ASSET_REF_RE = /(?:src|href)="([^"]+\.(?:webp|png|jpe?g|gif|svg|avif))"/gi;
/** Any `<link>` tag (we filter to `rel="stylesheet"` and resolve its href per render). */
const LINK_TAG_RE = /<link\b[^>]*>/gi;

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
  // The active theme's render runtime (SPEC §2) — chosen from its manifest so the preview
  // registers the same filters + data cascade the build does (preview ≡ build).
  const runtime = themeRuntime(theme.manifest);

  const template =
    theme.templates.get(`${object.type}.liquid`) ?? theme.templates.get('default.liquid');
  if (!template) {
    throw new Error(
      `No template for type "${object.type}". Add templates/${object.type}.liquid or templates/default.liquid to the site.`,
    );
  }

  // The rest of the site's templates, keyed by bare name, so the entry template can
  // `{% layout %}` / `{% render %}` them (SPEC §6). `theme.templates` is keyed by
  // filename (`default.liquid`); strip `.liquid` to match how LiquidJS resolves names.
  const templates = bareNameTemplates(theme.templates);

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

  // Temporal context (SPEC §6): `now`/`today` for time-relative templates (used by
  // `where_exp` / the comparison filters), exactly as the CLI build derives it — preview ≡ build.
  const clock = buildClock(new Date());

  // Per-type collections for listing loops (SPEC §6), assembled exactly as the CLI build
  // does — same `effectiveUrl`, same @timber/content helper — so preview ≡ build.
  const collections = assembleCollections(model, effectiveUrl);

  // Preview the *live* edits: SEO (title/description) and URL reflect the current form.
  const liveObject: ContentObject = { ...object, data };
  const seo = pageSeo(liveObject, schema, site);

  // Multilingual (SPEC §5 → Multilingual): mirror the CLI build so the previewed page
  // shows the language switcher + hreflang exactly as the deployed page will (preview ≡ build).
  const translations = translationsOf(model, liveObject, effectiveUrl);
  const defaultLanguage =
    typeof site.defaultLanguage === 'string' ? site.defaultLanguage : undefined;
  const alternates = hreflangAlternates(translations, site, defaultLanguage);
  if (alternates.length > 0) seo.alternates = alternates;

  const renderInput: Parameters<typeof renderPage>[0] = {
    markdown: reassembleDocument(data, body),
    template,
    templates,
    site,
    collections,
    seo,
    now: clock.now,
    today: clock.today,
    // Per-theme runtime (SPEC §2 → Tier A), matching the CLI build (build.node.ts) so preview ≡
    // build for an imported theme: the engine's compat filters (Jekyll ecosystem, or Eleventy's)
    // plus — for an Eleventy theme — the flat data cascade + `_data` globals. Additive; a native
    // Timber theme is unaffected.
    extend: runtime.extend,
    flattenData: runtime.flattenData,
  };
  if (runtime.globals) renderInput.globals = runtime.globals;
  if (liveObject.lang !== undefined) renderInput.lang = liveObject.lang;
  if (translations.length > 0) renderInput.translations = translations;
  let html = await renderPage(renderInput);

  // Inline every committed stylesheet the page `<link>`s, in place of its (unreachable) href —
  // the sandboxed frame can't fetch it. Resolve each href to a repo path (strip the site base
  // path + leading slash), look it up among the loaded stylesheets, and swap the `<link>` for a
  // `<style>`. This handles the default theme (`assets/theme.css`) and an imported Jekyll
  // theme (`assets/css/style.css`) alike. External (CDN) stylesheets — and any we don't have —
  // are left untouched.
  const basePath = typeof site.basePath === 'string' ? site.basePath : '';
  html = html.replace(LINK_TAG_RE, (tag) => {
    if (!/\brel=(["'])stylesheet\1/i.test(tag)) return tag;
    const href = /\bhref=(["'])([^"']+)\1/i.exec(tag)?.[2];
    if (href === undefined) return tag;
    let path = href;
    if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length);
    path = path.replace(/^\//, '');
    const css = theme.stylesheets.get(path);
    return css !== undefined ? `<style data-timber-theme>${css}</style>` : tag;
  });

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
