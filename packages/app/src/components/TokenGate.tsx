import { useState } from 'react';
import { repoConfig } from '../github/config.js';

/**
 * The paste-a-PAT sign-in (SPEC §9): connect by pasting a GitHub fine-grained token —
 * no broker, no Cloudflare, no App. This is one implementation behind the `getToken()`
 * seam; the OAuth redirect / device-flow sign-ins are the others. The "Create a token"
 * link opens GitHub's token page in a new tab (GitHub blocks being embedded in an
 * iframe), pre-narrowed by the on-screen steps to this repo + the needed permissions.
 */
const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export function TokenGate({ onSubmit }: { onSubmit: (token: string) => void }): React.JSX.Element {
  const [value, setValue] = useState('');
  const repo = `${repoConfig.owner}/${repoConfig.repo}`;

  return (
    <div className="token-gate">
      <h1>Timber</h1>
      <p>
        Editing <code>{repo}</code>. Sign in by pasting a GitHub{' '}
        <strong>fine-grained personal access token</strong>:
      </p>
      <ol className="token-gate__steps">
        <li>
          <a href={NEW_TOKEN_URL} target="_blank" rel="noreferrer">
            Create a token on GitHub ↗
          </a>{' '}
          (opens a new tab).
        </li>
        <li>
          Under <strong>Repository access</strong>, choose <em>Only select repositories</em>{' '}
          and pick <code>{repo}</code>.
        </li>
        <li>
          Under <strong>Permissions → Repository</strong>, set{' '}
          <strong>Contents: Read and write</strong> (and <strong>Actions: Read and write</strong>{' '}
          so the editor can show deploy status). Choose an expiry, then{' '}
          <strong>Generate token</strong>.
        </li>
        <li>Copy it and paste it below.</li>
      </ol>
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
