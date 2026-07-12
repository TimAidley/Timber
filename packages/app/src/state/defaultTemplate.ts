/**
 * A minimal Liquid template used purely to drive in-browser live preview in this
 * slice. The real "one default theme" (SPEC §13) is Phase 7 and will live in the
 * site-template's `templates/`; here we only need enough to prove the preview path
 * runs the SAME generator (`renderPage`) the CI build uses — preview ≡ build.
 *
 * Templates are dumb (SPEC/CLAUDE.md): `page` is the front matter (auto-escaped by
 * the engine), `content` is the already-rendered, already-sanitized body HTML, passed
 * as trusted so `{{ content }}` emits it raw while other outputs stay escaped.
 */
export const defaultTemplate = `<article>
  <h1>{{ page.title }}</h1>
  {% if page.poster %}<figure><img src="{{ page.poster }}" alt="{{ page.posterAlt }}" style="max-width:100%" /></figure>{% endif %}
  {% if page.status %}<p class="status">Status: {{ page.status }}</p>{% endif %}
  {% if page.startDate %}<p class="date">{{ page.startDate }}</p>{% endif %}
  {% if page.tags %}<ul class="tags">{% for tag in page.tags %}<li>{{ tag }}</li>{% endfor %}</ul>{% endif %}
  {{ content }}
</article>
`;
