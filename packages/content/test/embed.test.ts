import { describe, expect, it } from 'vitest';
import { embedUrlProblem, parseEmbedUrl } from '../src/embed.js';
import { fieldToJsonSchema, isFieldKind } from '../src/fields.js';
import { loadSchemas } from '../src/schema.js';

describe('embed field type', () => {
  it('is a recognised field kind, as is the deprecated `video` spelling', () => {
    expect(isFieldKind('embed')).toBe(true);
    expect(isFieldKind('video')).toBe(true);
  });

  it('maps both spellings to a URI string', () => {
    expect(fieldToJsonSchema({ type: 'embed' })).toEqual({
      type: 'string',
      format: 'uri',
    });
    expect(fieldToJsonSchema({ type: 'video' })).toEqual({
      type: 'string',
      format: 'uri',
    });
  });

  it('parses in a schema file like any other field', () => {
    const schemas = loadSchemas(
      new Map([
        [
          'config/schemas/projects.yml',
          'kind: collection\nfields:\n  game:\n    type: embed\n    label: Playable build\n',
        ],
      ]),
    );
    expect(schemas.get('projects')?.fields.game).toEqual({
      type: 'embed',
      label: 'Playable build',
    });
  });
});

describe('parseEmbedUrl — provider links are rewritten', () => {
  const player = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';

  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ'],
  ])('resolves %s to the no-cookie player', (url) => {
    expect(parseEmbedUrl(url)).toEqual({
      provider: 'youtube',
      id: 'dQw4w9WgXcQ',
      src: player,
      poster: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    });
  });

  it.each([
    ['https://vimeo.com/123456789'],
    ['https://player.vimeo.com/video/123456789'],
  ])('resolves %s to the Vimeo player', (url) => {
    expect(parseEmbedUrl(url)).toEqual({
      provider: 'vimeo',
      id: '123456789',
      src: 'https://player.vimeo.com/video/123456789',
    });
  });

  it('rejects a provider link that names no video, rather than framing a page the provider refuses', () => {
    expect(parseEmbedUrl('https://www.youtube.com/feed/subscriptions')).toBeUndefined();
    expect(embedUrlProblem('https://www.youtube.com/feed/subscriptions')).toMatch(
      /names no video/,
    );
    expect(embedUrlProblem('https://vimeo.com/channels/staffpicks')).toMatch(
      /names no video/,
    );
  });

  it('rejects an id that could break out of the embed URL it is interpolated into', () => {
    // The id is interpolated into a generated embed URL, so an id carrying
    // quotes/brackets must never pass this boundary.
    expect(parseEmbedUrl('https://www.youtube.com/watch?v="><script>')).toBeUndefined();
  });

  it('rejects an id of the wrong shape for its provider', () => {
    expect(parseEmbedUrl('https://youtu.be/short')).toBeUndefined();
    expect(parseEmbedUrl('https://vimeo.com/not-a-number')).toBeUndefined();
  });
});

describe('parseEmbedUrl — anything else embeds as itself', () => {
  it('passes a non-provider https URL through as a direct embed', () => {
    expect(parseEmbedUrl('https://tim.aidley.com/redbaron/')).toEqual({
      provider: 'direct',
      src: 'https://tim.aidley.com/redbaron/',
    });
  });

  it('embeds a host that the video allowlist used to reject outright', () => {
    // The behaviour change that makes `embed` general: the provider list rewrites
    // the links it knows and steps out of the way for everything else.
    expect(parseEmbedUrl('https://evil.example.com/embed/xyz')).toEqual({
      provider: 'direct',
      src: 'https://evil.example.com/embed/xyz',
    });
  });

  it('keeps the query and fragment a web app may need', () => {
    expect(parseEmbedUrl('https://example.com/game/?level=3#start')?.src).toBe(
      'https://example.com/game/?level=3#start',
    );
  });

  it('normalises through the URL parser rather than echoing the input', () => {
    expect(parseEmbedUrl('https://EXAMPLE.com')?.src).toBe('https://example.com/');
  });
});

describe('parseEmbedUrl — what it still refuses', () => {
  it('refuses http, which would be mixed content on an HTTPS site', () => {
    expect(parseEmbedUrl('http://example.com/game/')).toBeUndefined();
    expect(embedUrlProblem('http://example.com/game/')).toMatch(/https/);
  });

  it.each([['javascript:alert(1)'], ['data:text/html,<script>alert(1)</script>']])(
    'refuses the %s scheme',
    (url) => {
      expect(parseEmbedUrl(url)).toBeUndefined();
    },
  );

  it('refuses http on a provider link too — the scheme is checked before the host', () => {
    expect(parseEmbedUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeUndefined();
  });

  it('refuses a string that is not a URL', () => {
    expect(embedUrlProblem('tim.aidley.com/redbaron')).toBe('is not a URL');
    expect(embedUrlProblem('not a url')).toBe('is not a URL');
  });

  it('says nothing is wrong with a URL that resolves', () => {
    expect(embedUrlProblem('https://tim.aidley.com/redbaron/')).toBeUndefined();
  });
});
