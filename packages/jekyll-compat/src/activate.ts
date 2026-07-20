/**
 * Activating an imported theme = pointing the settings singleton's `activeTheme` at the new
 * `themes/<name>/` folder (SPEC §13). Pure and isomorphic (string in, string out) so the CLI
 * and the browser import share it — the browser includes the patched settings file in the
 * import commit, the CLI writes it back to disk.
 */

/**
 * Surgically set a scalar string key in an `index.md`'s YAML front matter, preserving the rest
 * of the file (comments, key order, body) — so activating a theme doesn't reformat a user's
 * settings. Replaces the key's line if present, else appends it inside the front-matter block;
 * if the file has no front matter, prepends one.
 */
export function setFrontMatterScalar(
  source: string,
  key: string,
  value: string,
): string {
  const line = `${key}: ${value}`;
  const fm = /^(---\r?\n)([\s\S]*?)(\r?\n?---[ \t]*\r?\n?)/.exec(source);
  if (!fm) return `---\n${line}\n---\n\n${source}`;
  const [, open, block, close] = fm;
  const keyRe = new RegExp(`^${key}:.*$`, 'm');
  const newBlock = keyRe.test(block!)
    ? block!.replace(keyRe, line)
    : block!
      ? `${block}\n${line}`
      : line;
  return open + newBlock + close + source.slice(fm[0].length);
}
