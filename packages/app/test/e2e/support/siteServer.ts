import { execFile } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { promisify } from 'node:util';
import type { FakeRepo } from '@timber/fake-github';
import { writeRepoToDir } from '@timber/fake-github/node';

const execFileAsync = promisify(execFile);

export interface SiteBuild {
  sha: string;
  status: 'building' | 'ok' | 'failed';
  startedAt: string;
  finishedAt?: string;
  outDir: string;
  /** The generator's stdout + stderr, for triage when a build fails or warns. */
  log: string;
}

export interface SiteServer {
  /** The site's origin — what the content's `baseUrl` should be. */
  url: string;
  /** Every build attempted, newest first. */
  builds(): SiteBuild[];
  /** The sha the site is currently serving (the latest successful deploy's), if any. */
  servingSha(): string | undefined;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * The "GitHub Pages" of the virtual-user environment: every move of the default branch is
 * built with the real Node generator (`timber build`, the same entry point `deploy.yml`
 * runs) into its own directory, and the server serves the build belonging to the **latest
 * successful deploy run** the fake Actions reports. So the site changes when the editor
 * says the deploy finished — not before — and a deploy the scenario made fail leaves the
 * previous build live, exactly as Pages would.
 *
 * This is what lets a tester (or a test) hold the editor to account: after a publish, the
 * page on this server is the ground truth for "is it live, and does it match".
 */
export async function startSiteServer(
  repo: FakeRepo,
  options: { port: number; cliEntry: string; workDir?: string },
): Promise<SiteServer> {
  const workDir = options.workDir ?? join(tmpdir(), 'timber-virtual-user');
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  const builds = new Map<string, SiteBuild>();
  const defaultRef = `refs/heads/${repo.defaultBranch}`;

  async function build(sha: string): Promise<void> {
    if (builds.has(sha)) return;
    const dir = join(workDir, sha.slice(0, 12));
    const record: SiteBuild = {
      sha,
      status: 'building',
      startedAt: new Date().toISOString(),
      outDir: join(dir, 'out'),
      log: '',
    };
    builds.set(sha, record);
    try {
      await writeRepoToDir(repo, sha, join(dir, 'src'));
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [options.cliEntry, 'build', join(dir, 'src'), record.outDir],
        { maxBuffer: 16 * 1024 * 1024 },
      );
      record.log = `${stdout}${stderr}`;
      record.status = 'ok';
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      record.log = `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? String(err)}`;
      record.status = 'failed';
    }
    record.finishedAt = new Date().toISOString();
  }

  // Build whatever main already holds (the seed), then every later move of it.
  const initial = repo.getRef(repo.defaultBranch);
  if (initial) void build(initial);
  repo.onRefMove.push((ref, sha) => {
    if (ref === defaultRef) void build(sha);
  });

  /** The build to serve: the newest deploy run that completed successfully and built. */
  function serving(): SiteBuild | undefined {
    for (const run of repo.actions.list({
      workflowFile: repo.deployWorkflow,
      status: 'success',
    })) {
      const b = builds.get(run.headSha);
      if (b?.status === 'ok') return b;
    }
    return undefined;
  }

  function notBuilt(
    res: ServerResponse,
    status: number,
    title: string,
    body: string,
  ): void {
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
        `<body style="font:16px system-ui;margin:3rem;max-width:40rem"><h1>${title}</h1><p>${body}</p>` +
        `<p style="color:#666">Timber virtual-user environment — this page stands in for GitHub Pages.</p>`,
    );
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const current = serving();
    if (!current) {
      const pending = [...builds.values()].some((b) => b.status === 'building');
      return notBuilt(
        res,
        503,
        pending ? 'Site is building' : 'Site not deployed yet',
        pending
          ? 'The first build is still running; reload in a moment.'
          : 'No deploy has completed successfully yet.',
      );
    }
    const url = new URL(req.url ?? '/', 'http://site.invalid');
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (rel.endsWith('/') || rel === '.' || rel === '') rel = join(rel, 'index.html');
    let file = join(current.outDir, rel);
    try {
      const s = await stat(file);
      if (s.isDirectory()) {
        // `/about` → `/about/index.html`, as Pages does with a redirect.
        res.writeHead(301, { location: `${url.pathname}/`, 'cache-control': 'no-store' });
        return res.end();
      }
    } catch {
      file = join(current.outDir, '404.html');
      try {
        await stat(file);
      } catch {
        return notBuilt(
          res,
          404,
          'Not found',
          `No such page in build ${current.sha.slice(0, 7)}.`,
        );
      }
      res.statusCode = 404;
    }
    if (res.statusCode !== 404) res.statusCode = 200;
    res.setHeader(
      'content-type',
      MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    );
    // Static, but never cached: a tester reloading after a deploy must see the new build.
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-timber-build', current.sha);
    createReadStream(file).pipe(res);
  });

  await new Promise<void>((resolve) => server.listen(options.port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${options.port}`,
    builds: () =>
      [...builds.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
    servingSha: () => serving()?.sha,
    close: () =>
      new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
