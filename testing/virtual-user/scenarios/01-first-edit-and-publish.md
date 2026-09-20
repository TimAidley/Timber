# Charter 01 — Edit, autosave, publish, verify live

## Scope

The core loop on an existing page: edit a field and the body, confirm the autosave, publish,
confirm the deploy, and hold the **live site** to account for every change.

## Steps

1. Sign in. Open the **About** page.
2. Change the title to `About the hall`. Add a sentence to the body: `The hall was built
in 1952 and can be hired for private events.` Change the description field too.
3. Wait for the editor to report the edits saved (badges, header status). Reload. Confirm
   all three edits survived the reload.
4. Publish. Read the publish dialog carefully: does the list of changes match what you
   did, and only that? Confirm.
5. Wait for the deploy to complete (the header morphs through building to done).
6. Open the live site's About page in a second tab. Compare title, description (it may
   appear in the page `<head>`/meta — check the page source if the theme doesn't show it),
   body sentence, and the navigation label, against what you typed.
7. Back in the editor: reload. Does it agree everything is published and up to date?
8. Make one more small edit, publish again, and check the live site updates a second time
   (a second deploy is a different code path from the first).

## Checks

- Autosave persists across reload — every field, not just the title.
- The publish dialog's change list equals the set of files you actually changed.
- After the deploy completes, the live site shows exactly the published content; nothing
  stale, nothing from an unpublished edit.
- After publishing, the editor's own state (badges, "unpublished changes" count, header)
  agrees that nothing is pending.
- Second publish behaves like the first.

## Environment

Nothing unusual happens during this charter.
