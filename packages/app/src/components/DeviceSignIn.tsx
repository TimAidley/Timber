import { useEffect, useRef, useState } from 'react';
import { repoConfig } from '../github/config.js';
import { startDeviceLogin, pollForToken, type DeviceLogin } from '../github/deviceFlow.js';

type Phase = 'idle' | 'starting' | 'waiting' | 'error';

/**
 * Device-flow sign-in (SPEC §9): click → get a short code → approve on github.com →
 * the app polls until authorized. No client secret, no redirect. On success it calls
 * `onAuthed`; the token is already stored by {@link pollForToken}.
 */
export function DeviceSignIn({ onAuthed }: { onAuthed: () => void }): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle');
  const [login, setLogin] = useState<DeviceLogin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cancel an in-flight poll if the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function begin(): Promise<void> {
    setError(null);
    setPhase('starting');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const started = await startDeviceLogin();
      setLogin(started);
      setPhase('waiting');
      // Open GitHub's verification page (pre-filled with the code when available).
      window.open(started.verificationUriComplete ?? started.verificationUri, '_blank', 'noopener');
      await pollForToken(started, controller.signal);
      onAuthed();
    } catch (e) {
      if (controller.signal.aborted) return; // unmounted / restarted; ignore
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  return (
    <div className="token-gate">
      <h1>Timber</h1>
      <p>
        Editing <code>{repoConfig.owner}/{repoConfig.repo}</code>. Sign in with GitHub to edit
        this site.
      </p>

      {phase === 'waiting' && login ? (
        <div className="device-flow">
          <p>
            Enter this code at{' '}
            <a href={login.verificationUriComplete ?? login.verificationUri} target="_blank" rel="noreferrer">
              {login.verificationUri.replace(/^https?:\/\//, '')}
            </a>{' '}
            (opened in a new tab):
          </p>
          <p className="device-flow__code">
            <code>{login.userCode}</code>
          </p>
          <p className="device-flow__status" aria-live="polite">
            Waiting for you to authorize on GitHub…
          </p>
          <button type="button" onClick={begin}>
            Start over
          </button>
        </div>
      ) : (
        <>
          {error ? <p className="token-gate__error">{error}</p> : null}
          <button
            type="button"
            className="signin-btn"
            onClick={begin}
            disabled={phase === 'starting'}
          >
            {phase === 'starting' ? 'Starting…' : 'Sign in with GitHub'}
          </button>
        </>
      )}
    </div>
  );
}
