/**
 * A small inline "work in progress" spinner. Purely decorative (`aria-hidden`) — the
 * surrounding control carries the accessible busy state via `aria-busy` and its label,
 * so screen readers announce "Building…" rather than a spinning glyph.
 *
 * Shared by every control that reflects a running deploy (the Publish button's build
 * phase and the out-of-date banner's update phase both watch the same Pages deploy),
 * so the "Building…" affordance looks the same wherever it appears.
 */
export function Spinner(): React.JSX.Element {
  return <span className="btn-spinner" aria-hidden="true" />;
}
