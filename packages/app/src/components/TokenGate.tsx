import { useState } from 'react';
import { repoConfig } from '../github/config.js';

/**
 * The dev auth gate (SPEC §9): paste a fine-grained PAT to connect. This is the
 * `getToken()` seam's browser UI; a friendlier end-user sign-in flow is deferred
 * (SPEC §16) and would replace this without touching the editor.
 */
export function TokenGate({ onSubmit }: { onSubmit: (token: string) => void }): React.JSX.Element {
  const [value, setValue] = useState('');

  return (
    <div className="token-gate">
      <h1>Timber</h1>
      <p>
        Editing <code>{repoConfig.owner}/{repoConfig.repo}</code>. Paste a GitHub fine-grained
        personal access token with <strong>Contents: read &amp; write</strong> on that repo.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const token = value.trim();
          if (token) onSubmit(token);
        }}
      >
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="github_pat_…"
          autoComplete="off"
          spellCheck={false}
          aria-label="GitHub personal access token"
        />
        <button type="submit">Connect</button>
      </form>
    </div>
  );
}
