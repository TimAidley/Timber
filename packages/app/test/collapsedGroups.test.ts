import { afterEach, describe, expect, it } from 'vitest';
import {
  readCollapsedGroups,
  toggleCollapsedGroup,
  writeCollapsedGroups,
} from '../src/content/collapsedGroups.js';

const KEY = 'timber:contentList:collapsed';

afterEach(() => localStorage.removeItem(KEY));

describe('collapsed content groups', () => {
  it('round-trips through localStorage', () => {
    writeCollapsedGroups(new Set(['pages', 'events']));
    expect([...readCollapsedGroups()].sort()).toEqual(['events', 'pages']);
  });

  it('reads "nothing collapsed" when there is no stored value', () => {
    expect(readCollapsedGroups().size).toBe(0);
  });

  it('ignores a malformed stored value rather than throwing', () => {
    localStorage.setItem(KEY, 'not json');
    expect(readCollapsedGroups().size).toBe(0);
    localStorage.setItem(KEY, '{"pages":true}'); // right JSON, wrong shape
    expect(readCollapsedGroups().size).toBe(0);
    localStorage.setItem(KEY, '["events", 7, null]'); // keeps only the strings
    expect([...readCollapsedGroups()]).toEqual(['events']);
  });

  it('toggles a type in and out without mutating the input set', () => {
    const start: ReadonlySet<string> = new Set(['events']);
    const withPages = toggleCollapsedGroup(start, 'pages');
    expect([...withPages].sort()).toEqual(['events', 'pages']);
    expect([...start]).toEqual(['events']); // untouched

    expect([...toggleCollapsedGroup(withPages, 'events')]).toEqual(['pages']);
  });
});
