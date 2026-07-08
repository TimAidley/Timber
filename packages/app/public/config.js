// Timber site config — the ONLY file you edit per site.
//
// This is a runtime config (not baked into the build), so the Timber editor bundle is
// a version-pinned artifact you can drop in unchanged; each site just ships its own
// copy of this file. It is loaded before the app, is public by design (it holds no
// secrets — the client *secret* lives only in the broker), and changing it needs no
// rebuild.
//
// Fill in the four values below. Delete the OAuth block entirely to fall back to the
// dev "paste a Personal Access Token" sign-in.
window.__TIMBER_CONFIG__ = {
  // The content repo this editor edits.
  owner: 'your-github-login',
  repo: 'your-content-repo',

  oauth: {
    // From your GitHub App (or OAuth App): Settings → Developer settings.
    clientId: '',
    // Your deployed token-exchange broker (see packages/oauth-broker).
    brokerUrl: '',

    // Leave '' for a GitHub App (it ignores scope). Set to 'repo' only for a classic
    // OAuth App.
    scope: '',

    // Optional: pin the OAuth callback. Omit to use the editor's own URL (which is the
    // callback anyway). Set it only if you need to override that.
    // redirectUri: 'https://you.github.io/your-site/admin/',
  },
};
