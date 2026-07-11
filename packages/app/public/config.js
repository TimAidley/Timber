// Timber site config — OPTIONAL runtime override.
//
// Timber reads its config from three places, highest priority first:
//   1. window.__TIMBER_CONFIG__ set in THIS file,
//   2. VITE_TIMBER_* build vars — what the fork-and-go GitHub Action sets in deploy.yml,
//   3. built-in defaults.
//
// The fork-and-go deploy configures the editor via (2), so this file ships EMPTY — an
// empty object overrides nothing, and editing the deployed copy would be overwritten on
// the next deploy anyway. Configure the fork-and-go path via repo Variables, not here.
//
// You only edit this file if you HOST THE EDITOR YOURSELF (drop in a prebuilt Timber
// build) and want to configure it with NO rebuild. It holds no secrets — the client
// secret lives only in the broker. To use it, uncomment and fill in:
//
// window.__TIMBER_CONFIG__ = {
//   owner: 'your-github-login',
//   repo: 'your-content-repo',
//   oauth: {
//     clientId: '',
//     brokerUrl: '',
//     scope: '',          // '' for a GitHub App, 'repo' for a classic OAuth App
//     // flow: 'device',  // device flow (no client secret); omit for the redirect flow
//   },
// };

window.__TIMBER_CONFIG__ = {};
