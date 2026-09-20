# Charter 04 — Host failures during save and deploy

## Scope

Error handling on the write path: saves the host rejects, and a deploy that fails after a
successful publish. Nothing may be lost, the editor must say what happened, and recovery
must be possible from the UI.

## Steps

1. Sign in. Edit **About** (a title tweak). Wait until saved.
2. In a **second tab**, open
   `http://127.0.0.1:5198/__control/fail-next?method=PATCH&path=refs&status=500&times=2`
   — the next two branch updates the editor attempts will be rejected with a 500. Close it.
3. Edit **Welcome** (a sentence in the body). Watch the header and any badges: record the
   exact wording of whatever failure is reported and when. Do not reload yet. Wait and see
   whether it recovers on its own (it retries); note how long that took.
4. Edit the **site settings** page (site title). Confirm all three edits are now saved.
   Reload and confirm they persist.
5. In a second tab, open `http://127.0.0.1:5198/__control/deploy-fail-next`. Close it.
6. Publish. Watch the deploy status: it should complete as **failed**. Record what the
   editor shows and offers.
7. Use whatever the editor offers to re-run the deploy **without publishing again**. Watch
   it complete. On the live site, confirm all three edits are present.
8. Reload the editor. Confirm it reports nothing unpublished and no failure lingering.

## Checks

- A rejected save is reported clearly and recovers (automatically or via an offered
  retry) with no edit lost — verify by reload.
- Edits made _while_ a save was failing are not lost either.
- A failed deploy after a successful publish is reported as a deploy failure, not a
  publish failure, and the site keeps serving the previous build meanwhile.
- The re-run path works and the live site ends up with everything.
- Final editor state is clean.

## Environment

The two `/__control` URLs above are the staged events.
