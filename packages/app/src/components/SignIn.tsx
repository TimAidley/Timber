import { repoConfig } from '../github/config.js';

/**
 * The production sign-in gate (SPEC §9): "Sign in with GitHub" kicks off the OAuth
 * authorization-code + PKCE flow (`oauth.beginLogin`). Shown only when OAuth is
 * configured; otherwise the app falls back to the dev {@link TokenGate}.
 */
export function SignIn({
  onSignIn,
  error,
}: {
  onSignIn: () => void;
  error?: string | null;
}): React.JSX.Element {
  return (
    <div className="token-gate">
      <h1>Timber</h1>
      <p>
        Editing <code>{repoConfig.owner}/{repoConfig.repo}</code>. Sign in with GitHub to edit
        this site.
      </p>
      {error ? <p className="token-gate__error">{error}</p> : null}
      <button type="button" className="signin-btn" onClick={onSignIn}>
        Sign in with GitHub
      </button>
    </div>
  );
}
