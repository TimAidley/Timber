import { useEffect, useState } from 'react';
import { repoConfig } from './github/config.js';
import { getStoredToken, setStoredToken, clearStoredToken } from './github/token.js';
import { loadRepoSession, type RepoSession } from './state/repoSession.js';
import { TokenGate } from './components/TokenGate.js';
import { Editor } from './Editor.js';

/**
 * Top-level app (SPEC §9/§11): gate on a pasted PAT, connect to the configured
 * repo, assemble its content model, then hand a live {@link RepoSession} to the
 * editor. This is where the browser first talks to GitHub — Phase 4 loaded a
 * bundled demo repo; Phase 5 loads the real one.
 */
export function App(): React.JSX.Element {
  const [hasToken, setHasToken] = useState(() => getStoredToken() !== null);
  const [session, setSession] = useState<RepoSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasToken) return;
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
  }, [hasToken]);

  function resetToken(): void {
    clearStoredToken();
    setSession(null);
    setError(null);
    setHasToken(false);
  }

  if (!hasToken) {
    return (
      <TokenGate
        onSubmit={(token) => {
          setStoredToken(token);
          setHasToken(true);
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
        <button type="button" onClick={resetToken}>
          Use a different token
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
