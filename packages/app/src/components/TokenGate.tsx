import { useState } from 'react';
import { repoConfig } from '../host/config.js';
import { hostDescriptor } from '../host/hostDescriptor.js';
import { Wordmark } from './Wordmark.js';

/**
 * The paste-a-PAT sign-in (SPEC §9): connect by pasting a fine-grained token for the
 * configured host (GitHub or Gitea/Codeberg — the `getToken()` seam only sees a string),
 * no broker, no Cloudflare, no App. One implementation behind the seam (the OAuth
 * redirect / device-flow sign-ins are the others).
 *
 * The "Create a token" link opens the host's token page in a new tab (hosts block being
 * embedded in an iframe). On **GitHub** it pre-fills the name, resource owner, expiry, and
 * permissions via URL query params (a GitHub feature since Aug 2025); other hosts get the
 * plain token page and the on-screen steps cover the fields.
 */
function newTokenUrl(): string {
  if (!hostDescriptor.supportsTokenPrefill) return hostDescriptor.tokenSettingsUrl;
  const params = new URLSearchParams({
    name: `Timber ${repoConfig.repo}`.slice(0, 40),
    description: `Timber editor for ${repoConfig.owner}/${repoConfig.repo}`,
    target_name: repoConfig.owner, // resource owner (the repo's owner)
    expires_in: '90', // days; the user can change it on the form
    contents: 'write', // write implies read — commit content
    actions: 'write', // deploy-status reads + re-run failed deploys
  });
  return `${hostDescriptor.tokenSettingsUrl}?${params.toString()}`;
}

export function TokenGate({ onSubmit }: { onSubmit: (token: string) => void }): React.JSX.Element {
  const [value, setValue] = useState('');
  const repo = `${repoConfig.owner}/${repoConfig.repo}`;
  const host = hostDescriptor.label;
  const prefill = hostDescriptor.supportsTokenPrefill;

  return (
    <div className="token-gate">
      <h1><Wordmark /></h1>
      <p>
        Editing <code>{repo}</code>. Sign in by pasting a {host}{' '}
        <strong>fine-grained personal access token</strong>:
      </p>
      <ol className="token-gate__steps">
        <li>
          <a href={newTokenUrl()} target="_blank" rel="noreferrer">
            Create a token on {host} ↗
          </a>
          {prefill ? (
            <>
              {' '}— opens a new tab with the name, expiry, and <strong>Contents</strong> +{' '}
              <strong>Actions</strong> permissions already filled in.
            </>
          ) : (
            <>
              {' '}— give it <strong>read/write</strong> access to the repository's contents.
            </>
          )}
        </li>
        <li>
          {prefill ? (
            <>
              Under <strong>Repository access</strong>, choose <em>Only select repositories</em>{' '}
              and pick <code>{repo}</code>. <em>(This is the one field {host} can't pre-fill.)</em>
            </>
          ) : (
            <>
              Scope it to <code>{repo}</code> and confirm the contents read/write permission.
            </>
          )}
        </li>
        <li>Generate the token, then copy it.</li>
        <li>Paste it below.</li>
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
          placeholder={hostDescriptor.patPlaceholder}
          autoComplete="off"
          spellCheck={false}
          aria-label={`${hostDescriptor.label} personal access token`}
        />
        <button type="submit">Connect</button>
      </form>
    </div>
  );
}
