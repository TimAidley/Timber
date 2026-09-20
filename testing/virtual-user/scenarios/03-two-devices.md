# Charter 03 — A foreign write to the WIP branch

## Scope

Another device (or tab) commits to the same per-user branch while this session has edits.
The editor should notice, tell the user, and let them choose what wins — and what wins must
be what reaches the live site.

## Steps

1. Sign in. Open **Welcome**. Change the description to `Welcome to Hillside Primary`. Wait
   for it to be saved.
2. Stage the foreign write: in a **second tab**, open exactly

   `http://127.0.0.1:5198/__control/push?branch=alice_wip&path=content/pages/welcome/index.md&message=Edit%20from%20phone&content=---%0Aid%3A%20PAGE-HOME%0Atitle%3A%20Welcome%0Adescription%3A%20Edited%20on%20the%20bus%0Apublic%3A%20true%0A---%0A%0AThis%20is%20the%20phone%20version.%0A`

   (it commits a different description and body for the same page to your branch, as
   another device would). Close that tab; return to the editor.

3. Wait up to a minute. Record exactly how and when the editor tells you something changed
   underneath you, and what choices it offers.
4. Choose to keep **your** description. Then check the body: the foreign write changed it
   too — what does the editor show, and what will be published?
5. Publish. On the live site's Welcome page, compare description and body with what you
   intended to keep.
6. Reload the editor: does it agree everything is published, and does Welcome show the
   same content as the site?
7. Repeat steps 1–2 with the roles reversed: make NO local edit first, stage the push, and
   observe what the editor does with a purely foreign change on a page you have open.

## Checks

- The foreign change is surfaced (not silently overwritten, not silently adopted).
- Whatever the editor says will be published is what the live site shows.
- No edit is lost without the user having chosen to lose it.
- Editor state after publish is consistent with the branch and the site.

## Environment

The `/__control/push` URL above is the staged event; nothing else is unusual.
