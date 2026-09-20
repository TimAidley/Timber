# Charter 05 — Preview layouts and window sizes

## Scope

The preview pane in each layout the editor offers (side-by-side, tabbed, hidden, pop-out)
at three window sizes (use the resize tool: 1400×900, 800×900, 420×860): reachability,
freshness of the preview, persistence across reload, and agreement between preview and the
built site.

## Steps

1. Sign in. Open **About**. Note the current layout.
2. For each layout × size combination, in turn:
   - switch to it; confirm you can reach the editor **and** the preview;
   - type a change to the title; confirm the preview reflects it within a few seconds;
   - reload; confirm the layout persists and the change is still there (saved or
     restored as in-progress);
   - switch pages in the sidebar; confirm the preview follows the selected page.
3. Open the pop-out preview; edit; confirm it updates; close it.
4. At the smallest size, open the page list, pick another page, return to About.
5. Publish the final title. When deployed, compare the live About page with the preview
   you were looking at: same title, same body rendering.
6. Switch to the **Advanced** area in the tabbed layout: does its own preview work there,
   and does the Edit/Preview switch behave sensibly?

## Checks

- No layout × size combination loses access to the editor or the preview.
- The preview never goes blank, shows a stale version, or shows a different page than the
  one selected.
- Layout choice survives reload; in-progress text survives reload.
- Preview ≡ built site for the published content.
- Switching layouts loses no unsaved text.

## Environment

Nothing unusual happens during this charter.
