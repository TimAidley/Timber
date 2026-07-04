import { useEffect, useState } from 'react';
import { repoConfig } from './github/config.js';
import { authMode } from './github/auth.js';
import { getStoredToken, setStoredToken, clearStoredToken } from './github/token.js';
import * as oauth from './github/oauth.js';
import { loadRepoSession, type RepoSession } from './state/repoSession.js';
import { TokenGate } from './components/TokenGate.js';
import { SignIn } from './components/SignIn.js';
import { Editor } from './Editor.js';

/**
 * Top-level app (SPEC §9/§11): authenticate, connect to the configured repo, assemble
 * its content model, then hand a live {@link RepoSession} to the editor. Auth runs in
 * one of two modes behind the `getToken()` seam — production **OAuth** ("Sign in with
 * GitHub", via the broker) when configured, else the dev **paste-a-PAT** gate.
 */
export function App(): React.JSX.Element {
  const [authed, setAuthed] = useState(() =>
    authMode === 'oauth' ? oauth.isAuthenticated() : getStoredToken() !== null,
  );
  // Only block on "Signing in…" when we're actually returning from GitHub (`?code`).
  const [oauthResolving, setOauthResolving] = useState(
    authMode === 'oauth' && new URLSearchParams(window.location.search).has('code'),
  );
  const [authError, setAuthError] = useState<string | null>(null);
  const [session, setSession] = useState<RepoSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OAuth redirect-return: exchange the code for a token before anything else.
  useEffect(() => {
    if (authMode !== 'oauth') return;
    let cancelled = false;
    oauth
      .completeLogin()
      .then((handled) => {
        if (!cancelled && handled) setAuthed(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setAuthError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setOauthResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadRepoSession()
      .then((s) => {
        if (!cancelled) setSession(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authed]);

  function signOut(): void {
    if (authMode === 'oauth') oauth.signOut();
    else clearStoredToken();
    setSession(null);
    setError(null);
    setAuthError(null);
    setAuthed(false);
  }

  if (oauthResolving) {
    return <div className="app-status">Signing in…</div>;
  }

  if (!authed) {
    return authMode === 'oauth' ? (
      <SignIn
        onSignIn={() => {
          setAuthError(null);
          void oauth.beginLogin();
        }}
        error={authError}
      />
    ) : (
      <TokenGate
        onSubmit={(token) => {
          setStoredToken(token);
          setAuthed(true);
        }}
      />
    );
  }

  if (error) {
    return (
      <div className="app-status app-status--error">
        <p>
          Couldn’t load <code>{repoConfig.owner}/{repoConfig.repo}</code>: {error}
        </p>
        <button type="button" onClick={signOut}>
          {authMode === 'oauth' ? 'Sign out' : 'Use a different token'}
        </button>
      </div>
    );
  }

  if (loading || !session) {
    return (
      <div className="app-status">
        Loading <code>{repoConfig.owner}/{repoConfig.repo}</code>…
      </div>
    );
  }

  return <Editor session={session} />;
}
