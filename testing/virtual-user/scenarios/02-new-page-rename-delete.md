# Charter 02 — Create, rename, delete a page

## Scope

Object lifecycle: a new collection object, a slug/URL change, and a deletion, each taken
through publish and verified on the live site — including that the **old** URL and
navigation entry are gone after rename and delete.

## Steps

1. Sign in. Create a new page titled `Workshop courses` with a short body paragraph. Note
   the URL/slug the editor assigns.
2. Publish. When the deploy completes, open the live site: the new page at its URL, and
   its presence (or deliberate absence) in navigation.
3. Rename the page to `Courses`. Observe what the editor says about the URL. Publish.
4. On the live site: the page at its **new** URL; the **old** URL (does it 404, redirect,
   or still serve the page?); the navigation label.
5. Delete the page. Observe what the editor does with it before publish (struck-through?
   restorable?). Restore it, then delete it again, then publish.
6. On the live site: both URLs gone (or redirecting to something sensible); navigation
   without it; the other pages ("About", "Welcome") intact.
7. Reload the editor after each publish and confirm its page list agrees with the site.

## Checks

- The page list (names, badges, counts) matches reality at every step, including after
  reload.
- The publish dialog lists the rename as the right set of changes (a removal plus an
  addition, or a rename — either is fine, but it must include both paths).
- Old URLs after rename/delete behave consistently (say what they do).
- Restore-after-delete brings back the page and its content intact, with nothing left
  showing as pending that shouldn't be.
- Untouched pages are byte-for-byte unaffected on the live site.

## Environment

Nothing unusual happens during this charter.
