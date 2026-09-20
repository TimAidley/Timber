/**
 * The embed facade's styling and its click-to-load script, injected by the generator
 * into any page that carries an embed (SPEC §7 → Embeds).
 *
 * Why the generator ships these rather than each theme: a facade whose script is
 * missing is a *broken feature* — the play button does nothing — which is a different
 * class of failure from a figure that lost its float, and it shouldn't depend on every
 * theme remembering to carry five lines of JavaScript. So the working component comes
 * from the version-pinned generator and an embed works on any theme, including an
 * imported one, with no theme changes at all.
 *
 * The theme's job is to **override**, which is what the cascade layer is for: an
 * unlayered rule always beats a layered one, whatever its specificity or order, so a
 * theme restyles `.embed__play` with an ordinary rule and wins without reaching for
 * `!important` or having to know where this `<style>` landed. `--embed-ratio` and
 * `--embed-play-*` are the knobs for the common cases. (A browser with no `@layer`
 * support — pre-2022 — drops the block and shows an unstyled poster + link, which is
 * degraded but not broken.)
 */
const EMBED_CSS =
  `@layer timber.embed{` +
  // `--embed-ratio:auto` is the poster-shaped case: with no ratio on the box there is
  // no definite height for the percentages below to resolve against, so they fall back
  // to `auto` and the image's own dimensions size everything.
  `.embed{position:relative;display:block;width:100%;max-width:var(--embed-width,none);` +
  `margin-inline:auto;aspect-ratio:var(--embed-ratio,16/9);` +
  `overflow:hidden;background:var(--embed-backdrop,#000)}` +
  `.embed__launch{display:block;width:100%;height:100%;position:relative;` +
  `color:inherit;text-decoration:none}` +
  `.embed__poster{width:100%;height:100%;object-fit:cover;display:block}` +
  `.embed__play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}` +
  `.embed__play-icon{width:var(--embed-play-size,4rem);height:var(--embed-play-size,4rem);` +
  `fill:var(--embed-play-color,#fff);opacity:.85;` +
  `filter:drop-shadow(0 2px 6px rgba(0,0,0,.6));transition:opacity .2s ease,transform .2s ease}` +
  `.embed__launch:hover .embed__play-icon,.embed__launch:focus-visible .embed__play-icon` +
  `{opacity:1;transform:scale(1.08)}` +
  `.embed__frame{width:100%;height:100%;border:0;display:block}` +
  // While the iframe is up, the frame's own shape wins where one was given — so closing
  // is dropping this class, with nothing to restore.
  `.embed--playing{aspect-ratio:var(--embed-frame-ratio,var(--embed-ratio,16/9));` +
  `max-width:var(--embed-frame-width,var(--embed-width,none))}` +
  // The way back to the poster sits just under the embed, aligned to its right edge,
  // rather than floating over the corner: an iframe swallows the page's mouse events,
  // so a control overlaying it is a control whose hover state the page can only half
  // see — and it would cover the thing someone just asked to look at. Out here it is
  // always visible while playing, and needs no hover to find.
  `.embed__bar{display:flex;justify-content:flex-end;width:100%;margin-inline:auto;` +
  `padding-block-start:.4rem}` +
  `.embed__close{display:inline-flex;align-items:center;justify-content:center;padding:0;` +
  `border:0;cursor:pointer;background:var(--embed-close-bg,transparent);` +
  `width:var(--embed-close-size,1.75rem);height:var(--embed-close-size,1.75rem);` +
  `border-radius:50%;color:var(--embed-close-color,currentColor);opacity:.55;` +
  `transition:opacity .2s ease}` +
  `.embed__close:hover,.embed__close:focus-visible{opacity:1}` +
  `.embed__close svg{width:55%;height:55%;fill:currentColor;display:block}` +
  `@media (prefers-reduced-motion:reduce){.embed__play-icon,.embed__close{transition:none}` +
  `.embed__launch:hover .embed__play-icon{transform:none}}` +
  `}`;

/**
 * Click-to-load. One delegated listener on the document, so it is indifferent to where
 * the script landed, how many embeds a page has, and whether they were in the markup at
 * parse time.
 *
 * Only a plain left click is taken: a modified click (⌘/ctrl/shift/middle) is someone
 * asking for a new tab or window, and the anchor already does that correctly — hijacking
 * it would be taking away the behaviour the facade is careful to preserve.
 */
const EMBED_JS =
  `(function(){` +
  // Font Awesome Free's `xmark` (CC BY 4.0), like the play icon. A constant here, not
  // author content, which is why it can be set as innerHTML; everything that came from
  // the page is set through the DOM instead.
  `var ICON='<svg viewBox="0 0 352 512" aria-hidden="true" focusable="false">` +
  `<path d="M242.7 256l100.1-100.1c12.3-12.3 12.3-32.2 0-44.5l-22.2-22.2c-12.3-12.3-32.2-12.3-44.5 0` +
  `L176 189.3 75.9 89.2c-12.3-12.3-32.2-12.3-44.5 0L9.2 111.4c-12.3 12.3-12.3 32.2 0 44.5L109.3 256` +
  ` 9.2 356.1c-12.3 12.3-12.3 32.2 0 44.5l22.2 22.2c12.3 12.3 32.2 12.3 44.5 0L176 322.7l100.1 100.1` +
  `c12.3 12.3 32.2 12.3 44.5 0l22.2-22.2c12.3-12.3 12.3-32.2 0-44.5L242.7 256z"/></svg>';` +
  // The bar is a sibling of the box, not a child: it has to sit outside the frame, and
  // `.embed` clips its contents. It mirrors the box's own max-width so its right edge
  // lines up with the embed's, whatever width the embed was given.
  `function closeBar(box,label){` +
  `var bar=document.createElement('div');` +
  `bar.className='embed__bar';` +
  `var width=window.getComputedStyle?window.getComputedStyle(box).maxWidth:'';` +
  `if(width)bar.style.maxWidth=width;` +
  `var b=document.createElement('button');` +
  `b.type='button';` +
  `b.className='embed__close';` +
  `b.setAttribute('aria-label',label?'Close '+label:'Close');` +
  `b.innerHTML=ICON;` +
  `bar.appendChild(b);` +
  `return bar;}` +
  `document.addEventListener('click',function(e){` +
  `if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;` +
  `var t=e.target;` +
  `if(!t||!t.closest)return;` +
  // Closing first: the button sits inside the box, so the launch lookup below would
  // never match it, but the order says which gesture wins if that ever changes.
  `var closer=t.closest('.embed__bar .embed__close');` +
  `if(closer){` +
  // The bar is inserted directly after its box and removed with it, so the box is
  // always the element before it.
  `var bar=closer.closest('.embed__bar');` +
  `var open=bar.previousElementSibling;` +
  `if(!open||!open.classList.contains('embed'))return;` +
  `var frame=open.querySelector('.embed__frame');` +
  `var facade=open.querySelector('.embed__launch');` +
  `e.preventDefault();` +
  // Removing the iframe is the point of the button: it unloads the third party, which
  // is what stops a game or a video still running behind the poster.
  `if(frame)open.removeChild(frame);` +
  `bar.parentNode.removeChild(bar);` +
  `open.classList.remove('embed--playing');` +
  `if(facade){facade.style.display='';facade.focus();}` +
  `return;}` +
  `var launch=t.closest('.embed--inline .embed__launch');` +
  `if(!launch)return;` +
  `var box=launch.closest('.embed');` +
  `var src=box&&box.getAttribute('data-embed-src');` +
  `if(!src)return;` +
  `e.preventDefault();` +
  `var label=box.getAttribute('data-embed-title')||'';` +
  `var frame=document.createElement('iframe');` +
  `frame.className='embed__frame';` +
  `frame.src=src;` +
  `frame.title=label||'Embedded content';` +
  `frame.setAttribute('allow','autoplay; fullscreen; gamepad; encrypted-media; picture-in-picture');` +
  `frame.setAttribute('allowfullscreen','');` +
  // The poster and the iframe share one box, so a different shape for the loaded embed
  // is that box being re-sized as they swap. These go on their OWN properties, which
  // `.embed--playing` prefers, so closing is just dropping the class — nothing has to
  // remember what the poster's values were.
  `var r=box.getAttribute('data-embed-frame-ratio');` +
  // An iframe has no intrinsic size, so a poster-shaped box has to be given a real
  // ratio before the poster it was measuring is taken out of the flow. Measuring the
  // poster itself — rather than falling back to 16/9 — is what stops the page jumping
  // when someone clicks play. Measured while it is still laid out.
  `if(!r&&box.style.getPropertyValue('--embed-ratio').trim()==='auto'){` +
  `var p=launch.querySelector('.embed__poster');` +
  `if(p&&p.naturalWidth&&p.naturalHeight)r=p.naturalWidth+'/'+p.naturalHeight;` +
  `else if(launch.offsetWidth&&launch.offsetHeight)r=launch.offsetWidth+'/'+launch.offsetHeight;` +
  `else r='16/9';}` +
  `if(r)box.style.setProperty('--embed-frame-ratio',r);` +
  `var w=box.getAttribute('data-embed-frame-width');` +
  `if(w)box.style.setProperty('--embed-frame-width',w);` +
  `box.classList.add('embed--playing');` +
  // Hidden rather than removed, so closing puts back the very same poster — already
  // decoded by the browser — instead of building a new one and fetching it again.
  `launch.style.display='none';` +
  `box.appendChild(frame);` +
  `if(box.parentNode)box.parentNode.insertBefore(closeBar(box,label),box.nextSibling);` +
  // A game or a video wants the keys the page would otherwise take, and the click that
  // swapped the frame in landed on an element that is no longer showing.
  `frame.focus();` +
  `},false);` +
  `})();`;

/** An embed is on the page if the wrapper class is. */
const EMBED_CLASS = /class="[^"]*\bembed\b/;
/** …and it needs the script only if one of them is click-to-load. */
const INLINE_EMBED = /\bdata-embed-src=/;

const HEAD_CLOSE = /<\/head\s*>/i;
const BODY_CLOSE = /<\/body\s*>/i;

/**
 * Add the embed styling (and, for a click-to-load embed, the activation script) to a
 * rendered page that has one; return the HTML untouched when it hasn't.
 *
 * Applied once over the assembled document — like the wordmark's `<style>`, and for the
 * same reason: an embed can reach a page by more than one route (the `{% embed %}` tag
 * in a template, a body directive next), and injecting from inside any one of them would
 * miss the others and duplicate on a listing page. A page with only `newtab` embeds gets
 * no script, because that mode needs none.
 *
 * A template that renders a bare fragment (the advanced-area preview can) has no head or
 * body to insert before, so both fall back to prepend/append — still valid, still applies.
 */
export function injectEmbedAssets(html: string): string {
  if (!EMBED_CLASS.test(html)) return html;

  let out = html;
  const style = `<style>${EMBED_CSS}</style>`;
  const head = HEAD_CLOSE.exec(out);
  out = head ? out.slice(0, head.index) + style + out.slice(head.index) : style + out;

  if (INLINE_EMBED.test(out)) {
    const script = `<script>${EMBED_JS}</script>`;
    const body = BODY_CLOSE.exec(out);
    out = body ? out.slice(0, body.index) + script + out.slice(body.index) : out + script;
  }
  return out;
}
