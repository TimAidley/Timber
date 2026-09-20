import { readdir, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, relative, sep } from 'node:path';
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

/**
 * Commit every file under `dir` onto a branch of the fake repo — the way a test or a
 * virtual-user run gets a realistic content repo: point it at `site-template/` and the
 * editor loads the same schemas, theme and sample content a real fork-and-go site has.
 * Node-only (filesystem), hence its own entry point.
 */
export async function seedRepoFromDir(
  repo: FakeRepo,
  dir: string,
  options: { branch?: string; message?: string } = {},
): Promise<CommitObject> {
  const files: Record<string, Uint8Array> = {};
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full);
      } else if (entry.isFile()) {
        files[relative(dir, full).split(sep).join('/')] = new Uint8Array(
          await readFile(full),
        );
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
