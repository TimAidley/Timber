# @timber/fake-github

An in-memory GitHub that speaks exactly the REST subset Timber's `RepoClient` uses — the
Git Data API (blobs/trees/commits/refs), repo metadata, branches, contents, compare, the
authenticated user, and Actions runs/jobs/dispatch. It exists so the editor can be driven
**end to end without the network**: by a test, or by a virtual user exploring the UI.

It is a real (tiny) git: objects are content-addressed with git's own hashing, so blob and
tree SHAs match what `git hash-object` / `git write-tree` would produce; a non-forced ref
update must be a fast-forward or it fails with GitHub's exact 422 wording; `compare`
computes a merge base and a three-dot diff. What it deliberately isn't: complete. Anything
it doesn't model is a 404 recorded in `fake.unhandled`, so a test can prove the client
asked for nothing unmodelled.

## Use

```ts
import { FakeGitHub } from '@timber/fake-github';
import { seedRepoFromDir } from '@timber/fake-github/node'; // Node only
import { routeFakeGitHub } from '@timber/fake-github/playwright'; // needs playwright

const fake = new FakeGitHub();
fake.addUser('alice', 'ghp_fake'); // bearer token → login
const repo = fake.addRepo({
  owner: 'acme',
  repo: 'site',
  actions: { queuedMs: 500, runMs: 3000 },
});
await seedRepoFromDir(repo, 'site-template'); // commit a directory onto main

// In-process: hand the fake's fetch to the real client.
const client = new RepoClient({
  owner: 'acme',
  repo: 'site',
  getToken: async () => 'ghp_fake',
  fetchImpl: fake.fetch,
});

// In a browser: answer api.github.com from the fake (CORS + preflight handled).
await routeFakeGitHub(context, fake);
```

`FakeRepo` also exposes the world outside the browser — `writeFiles()` to stage a foreign
push, `readFile()` / `log()` to assert what actually landed — and `fake.failNext()` /
`fake.onRequest` to script the failures the editor must survive (a 401 mid-save, a ref
that moves between commit and update).

Actions runs progress as a function of the clock (`now()` is injectable), so a deploy's
queued → in_progress → completed arc is deterministic under test and real-time for a human.

## Known fidelity gaps

- Renames in `compare` are detected only for identical content (the editor's asset moves).
  GitHub also pairs _similar_ files; the fake reports those as removed + added.
- No pagination `Link` headers (everything fits one page), no rate-limit headers.
- `POST /git/trees` accepts inline `content` but the client never sends it.
