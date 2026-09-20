import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, relative, sep } from 'node:path';
import type { CommitObject } from './objects.js';
import type { FakeRepo } from './repo.js';
import type { FakeGitHub } from './router.js';

export interface FakeGitHubServer {
  /** The API root to hand the editor as `apiBaseUrl`, e.g. `http://127.0.0.1:4711`. */
  url: string;
  close(): Promise<void>;
}

/**
 * Serve the fake over plain HTTP on localhost, for a browser the harness doesn't control
 * — a human's, or the one Playwright MCP launches for a virtual user. The editor is
 * pointed at it through its `apiBaseUrl` config (the same knob GitHub Enterprise Server
 * uses), so no request interception is needed. Whatever host the request arrives on, it
 * is re-addressed to the fake's own `apiOrigin` before routing; the fake stays
 * origin-agnostic and CORS is already handled inside it.
 *
 * `onRequest` lets a launcher mount extra endpoints (a control API) in front of the fake.
 */
export async function serveFakeGitHub(
  fake: FakeGitHub,
  options: {
    port?: number;
    host?: string;
    onRequest?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean;
  } = {},
): Promise<FakeGitHubServer> {
  const server = createServer(async (req, res) => {
    try {
      if (options.onRequest && (await options.onRequest(req, res))) return;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(', '));
      }
      const method = req.method ?? 'GET';
      const response = await fake.handle(
        new Request(fake.apiOrigin + (req.url ?? '/'), {
          method,
          headers,
          ...(body.length && method !== 'GET' && method !== 'HEAD' ? { body } : {}),
        }),
      );
      const out: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        out[key] = value;
      });
      res.writeHead(response.status, out);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: `fake-github server error: ${String(err)}` }));
    }
  });
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, host, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${host}:${port}`,
    close: () =>
      new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

/** Directory names never seeded — a `.git` from a real checkout would poison the tree. */
const SKIP_DIRS = new Set(['.git', 'node_modules']);

/** Files a seed `transform` is offered — text formats the content model and theme use. */
const TEXT_FILE = /\.(md|ya?ml|json|liquid|html|css|scss|js|txt|xml|svg)$/i;

/**
 * Commit every file under `dir` onto a branch of the fake repo — the way a test or a
 * virtual-user run gets a realistic content repo: point it at `site-template/` and the
 * editor loads the same schemas, theme and sample content a real fork-and-go site has.
 * Node-only (filesystem), hence its own entry point.
 */
export async function seedRepoFromDir(
  repo: FakeRepo,
  dir: string,
  options: {
    branch?: string;
    message?: string;
    /**
     * Adjust a file's text before it is committed (e.g. point the site's `baseUrl` at a
     * local server). Return the text unchanged to keep it. Binary files are not offered.
     */
    transform?: (path: string, text: string) => string;
  } = {},
): Promise<CommitObject> {
  const files: Record<string, Uint8Array> = {};
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full);
      } else if (entry.isFile()) {
        const path = relative(dir, full).split(sep).join('/');
        let bytes = new Uint8Array(await readFile(full));
        if (options.transform && TEXT_FILE.test(path)) {
          const text = new TextDecoder().decode(bytes);
          const next = options.transform(path, text);
          if (next !== text) bytes = new TextEncoder().encode(next);
        }
        files[path] = bytes;
      }
    }
  };
  await walk(dir);
  return repo.writeFiles(
    options.branch ?? repo.defaultBranch,
    files,
    options.message ?? `Seed from ${dir}`,
  );
}

/**
 * Write a branch's (or commit's) full tree to a directory on disk — the input the Node
 * generator (`timber build <dir> <out>`) takes. A launcher does this on every move of the
 * default branch to build the site exactly as the deploy workflow would.
 */
export async function writeRepoToDir(
  repo: FakeRepo,
  ref: string,
  dir: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const path of repo.listFiles(ref)) {
    const bytes = repo.readBytes(path, ref);
    if (!bytes) continue;
    const full = join(dir, ...path.split('/'));
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }
}
