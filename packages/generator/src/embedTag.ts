import type { Liquid } from 'liquidjs';
import { embedHtml, type EmbedSpec } from './embedMarkup.js';

/**
 * The `{% embed %}` tag (SPEC §7 → Embeds):
 *
 *   {% embed url: page.game, poster: page.thumbnail, label: page.title, mode: 'inline' %}
 *
 * A theme asks for an embed and places it; it never constructs an iframe `src` or
 * decides what the facade is made of. That keeps the URL→markup rules in one place
 * (`embedMarkup.ts`), where the injected script and styling can match them, instead of
 * in every theme that wants a video or a game on a page.
 *
 * Named arguments rather than a filter chain, because an embed takes five and four are
 * optional. LiquidJS parses them against the render context before `render` is called,
 * so `url: page.game` arrives as the resolved value.
 *
 * What the tag returns is written to the output stream as-is, bypassing the engine's
 * output escaper — correct here and nowhere else: the markup is assembled by
 * `embedHtml` from an escaped, shape-checked URL, never from author HTML.
 */
function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
}

export function registerEmbedTag(engine: Liquid): void {
  engine.registerTag('embed', {
    render(_ctx, _emitter, args: Record<string, unknown>): string {
      const url = stringArg(args, 'url');
      // No URL is the ordinary case of a page that simply has no embed — the theme
      // wrote `{% embed url: page.game %}` and this page set no game — so it renders
      // nothing rather than failing the build.
      if (!url) return '';

      const poster = stringArg(args, 'poster');
      const label = stringArg(args, 'label');
      const ratio = stringArg(args, 'ratio');
      const mode = stringArg(args, 'mode');

      const spec: EmbedSpec = {
        url,
        ...(poster !== undefined ? { poster } : {}),
        ...(label !== undefined ? { label } : {}),
        ...(ratio !== undefined ? { ratio } : {}),
        ...(mode === 'newtab' || mode === 'inline' ? { mode } : {}),
      };
      return embedHtml(spec);
    },
  });
}
