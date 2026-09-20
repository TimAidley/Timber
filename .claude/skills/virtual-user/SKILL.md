---
name: virtual-user
description: Run a virtual-user test of the Timber editor — a blind tester agent drives the real UI in a browser (Playwright MCP) against an in-memory fake GitHub, then you triage its findings against the code. Use when asked to "user test", "play a user", "run a scenario", or find bugs by using the app rather than reading it.
---

# Virtual-user testing

Two roles, kept apart on purpose:

- **The tester** (`virtual-user` subagent) is a QA engineer who is blind to the code: it
  has only the Playwright MCP tools and `Write`. It cannot read the repo, run a shell, or
  see this conversation. It works a test charter against the live editor **and the built
  site**, and reports _what happened vs. what it expected_.
- **You** are the sighted triager: you start the environment, brief the tester, then check
  its report against the fake's ground truth and the source, and turn confirmed bugs into
  deterministic tests.

Never merge the roles. Do not give the tester the repo path, file names, or how anything
is implemented; do not "help" it mid-run. If it gets stuck, that is a finding.

## Prerequisites

- Playwright MCP configured (the repo's `.mcp.json` does this: `npx @playwright/mcp@latest
--isolated`). Check the `mcp__playwright__*` tools are available before starting.
- Playwright MCP has a browser. On a fresh machine it doesn't: the first navigation fails
  with an "install" hint. Run `npx playwright install chromium` (or use the MCP's own
  `browser_install` tool) once, before spawning the tester.
- `pnpm -r build` has been run (the app resolves the workspace packages' `dist/`).

## Procedure

1. **Start the environment** in the background and wait for its banner:

   ```
   pnpm virtual-user
   ```

   It prints the editor URL (`http://127.0.0.1:5199/`), the **live site** URL
   (`http://127.0.0.1:5197` — rebuilt by the real Node generator on every deploy and
   served from the latest _successful_ deploy, like Pages), the fake GitHub URL
   (`http://127.0.0.1:5198`), the sign-in token, and the control API. The fake repo is
   seeded fresh from `site-template/` on every start — restart it between charters (it
   stops any previous instance itself).

2. **Pick a charter** from `testing/virtual-user/scenarios/`, or write one in the same
   shape (scope · steps · checks · environment). Charters say what to exercise and what
   must hold, not which control to click; they may tell the tester to open a
   `/__control/...` URL in a second tab at a given moment — that is how "someone else
   pushed" or "the host failed" is staged.

3. **Ask which model to run the tester on**, in a plain sentence (no picker widget), e.g.
   _"Run the tester on the same model as this session, or a cheaper one such as Sonnet?"_
   Default to the session's model if the user has no preference. Effort can't be chosen
   per run — it is inherited from the session (or pinned in the agent file); say so if the
   user asks.

4. **Spawn the tester** with the `Agent` tool, `subagent_type: virtual-user`, passing the
   chosen `model`. The prompt is ONLY: the charter file's contents, the editor URL, the
   live-site URL, the token, and the report path
   `testing/virtual-user/findings/<YYYY-MM-DD>-<charter>.md`. Nothing about the code. Run
   it in the foreground if you have nothing else to do; it typically takes a few minutes.
   - The report path must not already exist: the tester has no `Read` tool, so it cannot
     overwrite a file. Re-running a charter the same day → add a `-2`, `-3` suffix.

5. **Get ground truth** before reading the report's conclusions:
   `curl -s http://127.0.0.1:5198/__control/state` — branches, files and commit log per
   branch, deploy runs, and any request the fake didn't model (`unhandled`, which is a
   fake-github gap to fix, not an app bug) — and `/__control/builds` for each site build's
   status and generator log, plus the sha the site is serving. A generator warning or a
   failed build there is a finding in its own right.

6. **Triage each finding** against the state and the source:
   - _Confirmed bug_ → reproduce it as a deterministic test first (an `*.e2e.ts` on the
     harness in `packages/app/test/e2e/`, or a unit test if the cause is local), then fix
     it, in separate commits. Note the test's path in the finding.
   - _Intended behaviour_ → say why, in a line, under the finding.
   - _Tester error_ → say so; if the UI invited the error, that is itself a (UX) note.
   - _Cannot tell_ → leave it for the user with what you did establish.
     Append a `## Triage` section to the report with a verdict per finding.

7. **Report to the user**: the confirmed bugs (with repro test paths), the rest in a line
   each, and a link to the report file. Stop the environment with
   `curl -s http://127.0.0.1:5198/__control/shutdown` — stopping the background task alone
   can leave the node process (and its stale repo) alive behind the `pnpm` wrapper. A new
   `pnpm virtual-user` also calls this itself, so a leftover instance never blocks a fresh
   seed.

## Judgement notes

- The tester over-reports timing ("didn't save" after 2s when autosave takes ~4s; "site
  not updated" before the ~10s deploy finished). Check timing claims against
  `/__control/requests` and `/__control/builds` before believing either the tester or the
  app.
- An editor-vs-site mismatch is the highest-value class of finding this setup can
  produce: the site is built by the real generator from the real committed content, so a
  mismatch is either a publish bug, a preview≡build bug, or a template bug — never noise.
- A finding is more trustworthy when its repro is from a fresh sign-in and the state file
  agrees. Prefer confirming by re-running the steps in the harness over reasoning.
- The virtual user is a bug _discovery_ tool. It never becomes the regression suite — that
  is what the deterministic test in step 6 is for.
