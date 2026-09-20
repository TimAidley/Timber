import { describe, expect, it } from 'vitest';
import { validateEmbedBlocks } from '../src/embeds.js';

const GAME = 'https://tim.aidley.com/redbaron/';

/** The message text, for readable assertions. */
const messages = (body: string): string[] =>
  validateEmbedBlocks(body).map((e) => e.message);

describe('validateEmbedBlocks', () => {
  it('passes a well-formed block in either fence form', () => {
    expect(validateEmbedBlocks(`::embed{url="${GAME}" poster="game.webp"}\n`)).toEqual(
      [],
    );
    expect(validateEmbedBlocks(`:::embed{url="${GAME}"}\n:::\n`)).toEqual([]);
  });

  it('passes a body with no embed at all', () => {
    expect(validateEmbedBlocks('Just prose.\n\n![A plane](p.webp)\n')).toEqual([]);
  });

  it('reports a block with no url', () => {
    expect(messages('::embed{poster="game.webp"}\n')).toEqual(['embed block has no url']);
  });

  it('reports a URL that would not render, in the resolver’s own words', () => {
    // The same rule that renders it, so publish can't disagree with the page.
    expect(messages('::embed{url="http://tim.aidley.com/redbaron/"}\n')[0]).toMatch(
      /must be an https:\/\/ URL/,
    );
    expect(
      messages('::embed{url="https://www.youtube.com/feed/subscriptions"}\n')[0],
    ).toMatch(/names no video/);
  });

  it('reports a mode outside the vocabulary', () => {
    expect(messages(`::embed{url="${GAME}" mode="popup"}\n`)).toEqual([
      'embed has an unknown mode "popup"',
    ]);
  });

  it('reports a ratio the renderer would silently drop', () => {
    expect(messages(`::embed{url="${GAME}" ratio="1;background:red"}\n`)).toEqual([
      'embed has an unusable ratio "1;background:red"',
    ]);
    expect(validateEmbedBlocks(`::embed{url="${GAME}" ratio="4 / 3"}\n`)).toEqual([]);
  });

  it('ignores a block documented inside a code fence', () => {
    expect(validateEmbedBlocks('```\n::embed{url="http://insecure/"}\n```\n')).toEqual(
      [],
    );
  });

  it('reports every bad block in a body, not just the first', () => {
    expect(
      messages('::embed{}\n\nProse.\n\n::embed{url="http://insecure/"}\n'),
    ).toHaveLength(2);
  });
});
