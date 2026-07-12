import { useState } from 'react';
import { repoConfig } from '../github/config.js';

/**
 * The paste-a-PAT sign-in (SPEC §9): connect by pasting a GitHub fine-grained token —
 * no broker, no Cloudflare, no App. One implementation behind the `getToken()` seam
 * (the OAuth redirect / device-flow sign-ins are the others).
 *
 * The "Create a token" link opens GitHub's token page in a new tab (GitHub blocks being
 * embedded in an iframe) with the **name, resource owner, expiry, and permissions
 * pre-filled** via URL query params (a GitHub feature since Aug 2025). The one field that
 * can't be pre-filled is the specific-repository selection, so the on-screen steps cover it.
 */
function newTokenUrl(): string {
  const params = new URLSearchParams({
    name: `Timber ${repoConfig.repo}`.slice(0, 40),
    description: `Timber editor for ${repoConfig.owner}/${repoConfig.repo}`,
    target_name: repoConfig.owner, // resource owner (the repo's owner)
    expires_in: '90', // days; the user can change it on the form
    contents: 'write', // write implies read — commit content
    actions: 'write', // deploy-status reads + re-run failed deploys
  });
  return `https://github.com/settings/personal-access-tokens/new?${params.toString()}`;
}

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
          <a href={newTokenUrl()} target="_blank" rel="noreferrer">
            Create a token on GitHub ↗
          </a>{' '}
          — opens a new tab with the name, expiry, and <strong>Contents</strong> +{' '}
          <strong>Actions</strong> permissions already filled in.
        </li>
        <li>
          Under <strong>Repository access</strong>, choose <em>Only select repositories</em>{' '}
          and pick <code>{repo}</code>. <em>(This is the one field GitHub can't pre-fill.)</em>
        </li>
        <li>
          Scroll down, check the pre-filled permissions, and click{' '}
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
