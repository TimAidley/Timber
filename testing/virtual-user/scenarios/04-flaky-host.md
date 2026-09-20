# Scenario 04 — The host has a bad day

## Persona

You are Dev, a volunteer who maintains a running club's site in the evenings on a
flaky home connection. You are used to things failing and retrying; what you cannot stand
is losing work silently.

## Goal

Make three small edits (title tweaks or a sentence each) to the **About**, **Welcome** and
**site settings** pages, and get all three live — while the hosting service misbehaves
twice along the way. At the end, every one of your three edits must be live and the
editor must agree that nothing is left unpublished.

## Environment — follow these steps at the moments given

_The "View live" / "View site" links open a placeholder page in this environment — the built site is not served. Judge whether something is live by what the editor reports and by reloading it, not by following those links._

1. Sign in and make the first edit (About). Wait until the editor says it is saved.
2. Before the second edit, open a **second tab** and visit:
   `http://127.0.0.1:5198/__control/fail-next?method=PATCH&path=refs&status=500&times=2`
   (the next two saves the editor attempts will be rejected by the host). Close the tab.
3. Make the second edit (Welcome). Watch what the editor tells you. Keep going as Dev
   would: wait, retry if offered, do not refresh yet. Then make the third edit (settings).
4. Before publishing, open a second tab and visit:
   `http://127.0.0.1:5198/__control/deploy-fail-next`
   (the website build after your publish will fail). Close the tab.
5. Publish. Watch what happens to the publish status. Do whatever the editor offers to
   recover. If it offers nothing, say so.

## What to check deliberately

- Was any edit lost? Reload after everything settles and inspect all three pages.
- When a save failed, did the editor say so, and did it recover on its own or need you?
- When the build failed, did the editor say so, and could you get the site built without
  publishing again?
- At the end, does "nothing unpublished" match reality? (Reload to check.)
