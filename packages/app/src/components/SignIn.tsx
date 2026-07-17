import { repoConfig } from '../host/config.js';
import { hostDescriptor } from '../host/hostDescriptor.js';
import { Wordmark } from './Wordmark.js';

/**
 * The production sign-in gate (SPEC §9): "Sign in with <host>" kicks off the OAuth
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
  const host = hostDescriptor.label;
  return (
    <div className="token-gate">
      <h1><Wordmark /></h1>
      <p>
        Editing <code>{repoConfig.owner}/{repoConfig.repo}</code>. Sign in with {host} to edit
        this site.
      </p>
      {error ? <p className="token-gate__error">{error}</p> : null}
      <button type="button" className="signin-btn" onClick={onSignIn}>
        Sign in with {host}
      </button>
    </div>
  );
}
