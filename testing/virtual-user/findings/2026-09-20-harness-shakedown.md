# Harness shakedown — 2026-09-20

Not a scenario run: these are the findings from driving the editor with Playwright scripts
while building the fake GitHub and the virtual-user environment. Recorded here because
two of them are exactly the kind of thing the virtual user is for.

**Environment:** editor served by Vite (dev), headless Chromium 1400×900 (also 700×900 and
800×900), fake GitHub seeded from `site-template/`, fake PAT sign-in.

## Findings

### F1. Which page opens first after sign-in depends on network timing

- **Severity:** wrong result (minor, but nondeterministic behaviour is a bug magnet)
- **Steps to reproduce:** sign in to the same seeded repo several times over real HTTP
  (the `pnpm virtual-user` environment, not the Playwright-routed harness). Note the page
  selected in the editor after load.
- **Expected:** the same page every time (the first page in the content list).
- **Actual:** four runs: About, About, My Timber Site, My Timber Site.
- **Evidence:** run log from a four-iteration Playwright script: `first selected = About`
  ×2, `= My Timber Site` ×2.

### F2. The Tabs preview layout could not be made to fail

- Reported by the maintainer as currently broken. Tried: Tabs → Preview after an edit
  (preview reflected the edit), switching pages while in Preview, reload with Tabs
  persisted (comes back in Tabs, on the Edit tab), the Advanced view in Tabs mode
  (Preview tab shows the content preview), the pop-out, and a 700px viewport (mobile
  downgrade to tabs). Every variant rendered the editor or the preview correctly with no
  console errors.
- **Outcome:** not reproduced. Needs the maintainer's exact conditions (browser, window
  size, what "doesn't work" looks like — blank pane, stuck tab, no switch control?).

### F3. A request in flight during a reload is logged as an autosave failure

- Reloading the editor while an autosave was in flight produced
  `autosave: save to your branch failed {kind: server, … hostMessage: Failed to fetch,
status: 500}` in the console. Under the Playwright-routed harness the 500 comes from the
  route handler losing the page mid-request, so the status is an artefact of the harness;
  but a real browser aborting a fetch on unload would surface the same _log line_, as a
  network failure. Worth knowing when reading a tester's console evidence.

## Triage

- **F1 — confirmed.** `packages/app/src/Editor.tsx:505` selects `model.objects[0]`;
  `assembleContent` (`packages/content/src/assemble.ts:66`) builds objects by iterating
  the snapshot `Map`; `RepoClient.loadSnapshotWithTree` (`packages/github/src/client.ts`)
  inserted into that Map from inside a `Promise.all`, i.e. in blob-_completion_ order.
  Regression test: `packages/fake-github/test/repoClient.test.ts` ("loadSnapshot lists
  files in tree order whatever order the blobs arrive in") — fails before the fix, passes
  after. Fixed by inserting in tree order after all blobs have arrived. The Playwright-
  routed e2e harness never showed it because routed responses complete in request order;
  the plain-HTTP environment did. Both are worth keeping for exactly this reason.
- **F2 — open.** Awaiting the maintainer's reproduction conditions.
- **F3 — harness artefact / intended.** No app change. Noted in the tester agent's brief
  that console errors are evidence, not conclusions.
