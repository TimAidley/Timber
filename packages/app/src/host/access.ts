/**
 * The `canAccessAdvanced()` seam (SPEC §10). The advanced/admin area — editing
 * `templates/*.liquid` and `config/**` — is gated behind this single predicate. It
 * returns `true` for now (single-tenant dev); real roles drop in here later without
 * touching the UI, exactly as `getToken()` isolates auth. Keeping the gate in one
 * place is why the advanced view can be built without a role system existing yet.
 */
export function canAccessAdvanced(): boolean {
  return true;
}
