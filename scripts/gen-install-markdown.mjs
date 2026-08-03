#!/usr/bin/env node
// Regenerates INSTALL.md from docs/install.html — the printable view of the interactive
// setup guide, for reading in the repo on GitHub. Run after editing the page:
//   node scripts/gen-install-markdown.mjs
//
// The page shows one path at a time by hiding the blocks whose `data-when` doesn't match
// your choices; the Markdown shows every path and *labels* each block with the same
// conditions instead. Both come from one source, so the document can never describe a
// combination the page doesn't implement — which is exactly what hand-maintained prose
// ("follow this section only if…") kept failing to guarantee.
//
// test/install-page.test.ts fails when INSTALL.md is stale, and when any condition in the
// page fails to reach the Markdown — a silently dropped condition reads as an unconditional
// instruction, which is worse than a missing one.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, posix } from 'node:path';
import { JSDOM } from 'jsdom';

const GUIDE_URL = 'https://timaidley.github.io/Timber/install.html';

// Some value-sets deserve a collective name: spelling out "GitHub App — redirect or GitHub
// App — device flow" on thirteen consecutive troubleshooting entries is noise. Keyed by the
// exact `data-when` term. Everything else is named by the chooser's own option pills, so
// there is one place naming each individual choice.
const SET_LABELS = {
  'auth:app-redirect,app-device': 'either GitHub App flow',
  'auth:app-redirect,app-device,oauth': 'any one-click sign-in',
  'host:github,codeberg,gitlab': null, // every host — constrains nothing
};

// The pill labels read as button text ("A domain you own"); mid-sentence in a parenthesis
// they want to be lowercase. A few also render a name that changes with the host ("GitHub
// Pages" becomes "Codeberg Pages"), which can't survive into a static document.
const VALUE_LABELS = {
  'deploy:pages': "your host's own Pages",
  'deploy:cloudflare': 'Cloudflare Pages',
  'auth:oauth': 'Sign in with Codeberg/GitLab (OAuth)',
  'auth:pat': 'paste-a-PAT',
  'domain:default': "the host's default URL",
  'domain:custom': 'a domain you own',
};

// ---------------------------------------------------------------------------
// Conditions. A `data-when` is terms ANDed across axes, values ORed within one.
// Represented as Map<axis, Set<value>> so a child's condition can be intersected
// with the wrapper it sits inside.
// ---------------------------------------------------------------------------

function parseWhen(when) {
  const map = new Map();
  for (const term of when.trim().split(/\s+/)) {
    const [axis, values] = term.split(':');
    map.set(axis, new Set(values.split(',')));
  }
  return map;
}

/** Child condition narrowed by the wrapper it inherits from. */
function mergeConditions(outer, inner) {
  if (!outer) return inner;
  if (!inner) return outer;
  const merged = new Map(outer);
  for (const [axis, values] of inner) {
    const existing = merged.get(axis);
    merged.set(
      axis,
      existing ? new Set([...values].filter((v) => existing.has(v))) : values,
    );
  }
  return merged;
}

const sameCondition = (a, b) => describeWith(a) === describeWith(b);

function makeDescriber(doc) {
  const names = new Map();
  for (const label of doc.querySelectorAll('label[data-axis]')) {
    const clone = label.cloneNode(true);
    clone.querySelectorAll('.tag, input').forEach((n) => n.remove());
    const key = `${label.getAttribute('data-axis')}:${label.querySelector('input').value}`;
    names.set(key, VALUE_LABELS[key] ?? clone.textContent.replace(/\s+/g, ' ').trim());
  }
  const axisSize = (axis) =>
    [...names.keys()].filter((k) => k.startsWith(`${axis}:`)).length;

  return function describe(cond) {
    if (!cond) return null;
    const parts = [];
    for (const [axis, values] of cond) {
      // An axis listing all of its values narrows nothing — don't say it.
      if (values.size >= axisSize(axis)) continue;
      const term = `${axis}:${[...values].join(',')}`;
      if (term in SET_LABELS) {
        if (SET_LABELS[term]) parts.push(SET_LABELS[term]);
        continue;
      }
      parts.push([...values].map((v) => names.get(`${axis}:${v}`) ?? v).join(' or '));
    }
    return parts.length ? parts.join(' + ') : null;
  };
}

let describeWith = () => null; // rebound per document

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

/** `docs/`-relative hrefs, rewritten for a file that lives at the repo root. */
function rewriteHref(href) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  return posix.normalize(posix.join('docs', href));
}

function inline(node, covered) {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      out += child.textContent.replace(/\s+/g, ' ');
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = child.tagName.toLowerCase();
    if (child.dataset?.view === 'interactive') continue;

    // An inline condition has to survive into the prose: dropping it turns a conditional
    // clause into an unconditional instruction. Prefer a block in the source — this is the
    // fallback, not the good shape.
    if (child.hasAttribute('data-when')) {
      const label = describeWith(parseWhen(child.getAttribute('data-when')));
      covered.add(child);
      out += ` *(${label}: ${inline(child, covered).trim()})*`;
      continue;
    }
    if (tag === 'code') out += `\`${child.textContent.trim()}\``;
    else if (child.classList.contains('tag'))
      out += `${out.endsWith(' ') ? '' : ' '}*(${child.textContent.trim().toLowerCase()})*`;
    else if (tag === 'strong') out += `**${inline(child, covered).trim()}**`;
    else if (tag === 'em') out += `*${inline(child, covered).trim()}*`;
    else if (tag === 'a')
      out += `[${inline(child, covered).trim()}](${rewriteHref(child.getAttribute('href'))})`;
    else out += inline(child, covered);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Blocks. Each returns records so consecutive blocks sharing a condition can be
// collapsed under one label rather than repeating it.
// ---------------------------------------------------------------------------

/**
 * Label a run of records: only the first of each run carries the marker, so a wrapper
 * covering four paragraphs doesn't stamp the same condition on all four.
 *
 * `inset` records (blockquotes) take the marker *after* their leading `> `, since a marker
 * outside the quote would read as a separate paragraph.
 *
 * `group: false` compares each record against the seed instead of its predecessor. List
 * items and table rows are scanned independently — someone jumping to the fourth
 * troubleshooting entry never read the first, so inheriting its condition silently turns a
 * Codeberg-only note into a universal one.
 */
function label(records, seed = null, { group = true } = {}) {
  let previous = seed;
  const out = [];
  for (const record of records) {
    const text = describeWith(record.cond);
    const mark = text && !sameCondition(record.cond, previous);
    if (!mark) out.push(record.md);
    else if (record.inset) out.push(record.md.replace(/^> /, `> *(${text}.)* `));
    else out.push(`*(${text}.)* ${record.md}`);
    if (group) previous = record.cond;
  }
  return out;
}

function renderBlocks(node, inherited, covered) {
  const records = [];
  for (const el of node.children) {
    if (el.dataset?.view === 'interactive') continue;
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === 'string' ? el.className : '';
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') continue;

    const own = el.hasAttribute('data-when')
      ? parseWhen(el.getAttribute('data-when'))
      : null;
    const cond = mergeConditions(inherited, own);
    const mark = () => own && covered.add(el);

    if (tag === 'p') {
      const md = inline(el, covered).trim();
      if (md) {
        mark();
        records.push({ md, cond });
      }
    } else if (tag === 'ul' || tag === 'ol') {
      const items = [...el.children].map((li, i) => {
        const liOwn = li.hasAttribute('data-when')
          ? parseWhen(li.getAttribute('data-when'))
          : null;
        if (liOwn) covered.add(li);
        // A list item can carry its own blocks — the Cloudflare token list nests a <ul>,
        // several items end with a copyable value.
        const nested = li.querySelector('ul, ol');
        if (nested) nested.remove();
        const value = li.querySelector('.value');
        if (value) value.remove();

        let md = inline(li, covered).trim().replace(/\s+/g, ' ');
        if (value) {
          const k = value.querySelector('.k')?.textContent.trim();
          md += ` — ${k ? `**${k}:** ` : ''}\`${value.querySelector('code').textContent.trim()}\``;
        }
        if (nested) {
          const sub = label(renderBlocks({ children: [nested] }, cond, covered)).join(
            '\n',
          );
          md += `\n${sub
            .split('\n')
            .map((l) => (l ? `  ${l}` : l))
            .join('\n')}`;
        }
        return {
          md: `${tag === 'ol' ? `${i + 1}.` : '-'} ${md}`,
          cond: mergeConditions(cond, liOwn),
        };
      });
      // Markers go inside the bullet, after the marker character.
      const lines = label(items, cond, { group: false }).map((line) =>
        line.replace(/^\*\((.+?)\.\)\* (-|\d+\.) /, '$2 *($1.)* '),
      );
      mark();
      records.push({ md: lines.join('\n'), cond });
    } else if (tag === 'table') {
      const rows = [...el.querySelectorAll('tr')];
      const cells = (tr) =>
        [...tr.children].map((td) => inline(td, covered).trim().replace(/\|/g, '\\|'));
      const head = cells(rows[0]);
      const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
      for (const tr of rows.slice(1)) {
        const c = cells(tr);
        if (tr.hasAttribute('data-when')) {
          covered.add(tr);
          const text = describeWith(
            mergeConditions(cond, parseWhen(tr.getAttribute('data-when'))),
          );
          if (text) c[0] = `${c[0]} *(${text})*`;
        }
        lines.push(`| ${c.join(' | ')} |`);
      }
      mark();
      records.push({ md: lines.join('\n'), cond });
    } else if (cls.includes('note') || cls.includes('warn')) {
      const inner = label(renderBlocks(el, cond, covered), cond).join('\n\n');
      if (inner) {
        mark();
        const md = inner
          .split('\n')
          .map((l) => `> ${l}`.trimEnd())
          .join('\n');
        records.push({ md, cond, inset: true });
      }
    } else if (cls.includes('value')) {
      const k = el.querySelector('.k')?.textContent.trim();
      const v = el.querySelector('code')?.textContent.trim();
      mark();
      records.push({ md: `${k ? `**${k}:** ` : ''}\`${v}\``, cond });
    } else if (tag === 'div' || tag === 'section') {
      // A wrapper contributes its condition to its children rather than emitting a marker
      // of its own — an orphan "*(GitHub.)*" line above a paragraph reads badly.
      const inner = renderBlocks(el, cond, covered);
      if (inner.length) {
        mark();
        records.push(...inner);
      }
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function installMarkdown(html) {
  const doc = new JSDOM(html).window.document;
  describeWith = makeDescriber(doc);
  const covered = new Set();
  const lines = [];
  const push = (...parts) => lines.push(...parts);
  const section = (node, seed = null) =>
    label(renderBlocks(node, null, covered), seed).join('\n\n');

  push('<!-- GENERATED from docs/install.html by scripts/gen-install-markdown.mjs.');
  push('     Do not edit by hand — edit the page and regenerate. -->');
  push('');
  push(`# ${doc.querySelector('h1').textContent.replace(/\s+/g, ' ').trim()}`);
  push('');
  push(
    `> **This is the printable view.** The [interactive guide](${GUIDE_URL}) shows only the steps`,
    '> for your combination, fills your account and repo name into every URL and callback, and',
    '> gives you a tick box per step. Below is the same content with every path shown, each',
    '> block labelled with the choices it applies to.',
    '',
  );
  for (const p of doc.querySelectorAll('header.page p.lede'))
    push(inline(p, covered).trim(), '');

  push('## Choosing a sign-in method', '');
  push(section(doc.querySelector('#choosing')), '');

  let n = 0;
  for (const step of doc.querySelectorAll('.step')) {
    n += 1;
    const title = step.querySelector('h2 .title').textContent.trim();
    const tags = [...step.querySelectorAll('h2 .tag')].map((t) =>
      t.textContent.trim().toLowerCase(),
    );
    push(`## ${n}. ${title}${tags.length ? ` *(${tags.join(', ')})*` : ''}`, '');

    const own = step.hasAttribute('data-when')
      ? parseWhen(step.getAttribute('data-when'))
      : null;
    if (own) {
      covered.add(step);
      const text = describeWith(own);
      if (text) push(`**Applies to:** ${text}`, '');
    }
    // The step's own condition seeds the run, so the first child doesn't repeat it.
    push(label(renderBlocks(step, own, covered), own).join('\n\n'), '');
  }

  for (const id of ['troubleshooting', 'self-hosted']) {
    const node = doc.getElementById(id);
    push(`## ${node.querySelector('h2').textContent.trim()}`, '');
    push(section(node), '');
  }

  // A condition that reaches no prose has silently become an unconditional instruction.
  const unrepresented = [...doc.querySelectorAll('[data-when]')]
    .filter((el) => !el.closest('.controls') && !covered.has(el))
    .map(
      (el) =>
        `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}[data-when="${el.getAttribute('data-when')}"]`,
    );

  const markdown = `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
  return { markdown, unrepresented };
}

// --- CLI -------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { markdown, unrepresented } = installMarkdown(
    readFileSync(join(root, 'docs/install.html'), 'utf8'),
  );
  if (unrepresented.length) {
    console.error(
      `These conditions never reached the Markdown:\n  ${unrepresented.join('\n  ')}`,
    );
    process.exit(1);
  }
  writeFileSync(join(root, 'INSTALL.md'), markdown);
  console.log(`Wrote INSTALL.md (${markdown.split('\n').length} lines)`);
}
