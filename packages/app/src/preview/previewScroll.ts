/**
 * Keep the author's edit point visible across preview re-renders (SPEC §8).
 *
 * The preview frame reloads its whole document on every keystroke render (that's what
 * swapping `srcDoc` — or `document.write` in the pop-out — does), which resets scroll to
 * the top. Once a page outgrows the pane, the author would have to scroll back down after
 * every keystroke to see what they just typed. The fix has two halves, both driven from
 * the app side of the frame (the frame itself can never run scripts, §8/§9):
 *
 * 1. **Restore** the previous scroll offset after each reload, so the view doesn't jump.
 * 2. **Follow the edit:** diff the previous render's `<body>` against the new one to find
 *    the element containing the change, and scroll it into view if it isn't already.
 *
 * The diff walks both trees in parallel and localizes to the innermost changed element.
 * Because a keystroke changes exactly one text node (and the asset/theme URLs around it
 * are stable across renders — `AssetStore` caches object URLs per path), the first
 * difference in tree order *is* the edit point.
 */

/**
 * The innermost element of `newRoot` containing the first difference from `oldRoot`,
 * or `null` when the trees are equal (e.g. only the `<head>` changed). The two roots
 * may belong to different documents/realms (a clone kept from the previous render vs
 * the live frame body), so nodes are compared structurally, never by identity.
 */
export function findChangedElement(oldRoot: Element, newRoot: Element): Element | null {
  if (oldRoot.isEqualNode(newRoot)) return null;
  return descend(oldRoot, newRoot);
}

/** Localize a known difference between two same-tag elements (see findChangedElement). */
function descend(oldEl: Element, newEl: Element): Element {
  const oldKids = oldEl.childNodes;
  const newKids = newEl.childNodes;
  const shared = Math.min(oldKids.length, newKids.length);

  for (let i = 0; i < shared; i++) {
    const o = oldKids[i] as Node;
    const n = newKids[i] as Node;
    if (o.isEqualNode(n)) continue;
    // The same element edited in place — recurse to localize further.
    if (isElement(o) && isElement(n) && o.tagName === n.tagName) return descend(o, n);
    // A replaced node, or a text node whose content changed: the change lives here.
    return isElement(n) ? n : newEl;
  }

  if (newKids.length > oldKids.length) {
    // Nodes appended after a common prefix — anchor on the first added one.
    const added = newKids[shared] as Node;
    return isElement(added) ? added : newEl;
  }
  if (newKids.length < oldKids.length) {
    // Nodes removed from the end — anchor on what now sits nearest the removal.
    const last = newKids[newKids.length - 1];
    return last !== undefined && isElement(last) ? last : newEl;
  }
  // Children all equal, so the difference is in this element's own attributes.
  return newEl;
}

/** Realm-safe element check: `instanceof Element` fails across iframe realms. */
function isElement(node: Node): node is Element {
  return node.nodeType === 1; // Node.ELEMENT_NODE
}
