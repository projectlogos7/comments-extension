import { useState } from 'preact/hooks';
import { errorMessage } from '@pinpoint/ui';
import { bg, type ExtensionHost } from './extHost';

/** Signed-out state shared by the side panel and the extension app page. */
export function SignIn({ host }: { host: ExtensionHost }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState(host.serverUrl);
  const [showServer, setShowServer] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const after = async () => {
    await host.refreshSession().catch(() => {});
  };

  return (
    <div class="pp-auth">
      <div class="pp-auth-card">
        <span class="pp-logo pp-logo-lg" aria-hidden="true" />
        <h1 class="pp-h1">
          Sign in to Pinpoint
        </h1>
        <p class="pp-muted">Comment on any part of a page with your team.</p>
        <button class="pp-btn" disabled={busy} onClick={() => run(async () => (await bg({ type: 'auth.signIn', provider: 'google' }), after()))}>
          Continue with Google
        </button>
        <button class="pp-btn" disabled={busy} onClick={() => run(async () => (await bg({ type: 'auth.signIn', provider: 'microsoft' }), after()))}>
          Continue with Microsoft
        </button>
        <div class="pp-divider">or</div>
        {sent ? (
          <p role="status">Check your inbox for a sign-in link. This panel updates once you're signed in.</p>
        ) : (
          <form
            class="pp-row"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await bg({ type: 'auth.emailSignIn', email });
                setSent(true);
              });
            }}
          >
            <input class="pp-grow" type="email" required aria-label="Email" placeholder="you@company.com" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
            <button class="pp-btn pp-btn-primary" disabled={busy}>
              Email link
            </button>
          </form>
        )}
        <details>
          <summary class="pp-small pp-muted">Developer sign in</summary>
          <form
            class="pp-row"
            style={{ marginTop: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => (await bg({ type: 'auth.devSignIn', email, name: name || undefined }), after()));
            }}
          >
            <input class="pp-grow" aria-label="Name" placeholder="Name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            <button class="pp-btn" disabled={busy || !email}>
              Dev login
            </button>
          </form>
        </details>
        <button class="pp-link-btn pp-small" onClick={() => setShowServer(!showServer)}>
          Server: {host.serverUrl}
        </button>
        {showServer && (
          <form
            class="pp-row"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await bg({ type: 'settings.setServerUrl', serverUrl: server.trim().replace(/\/$/, '') });
                host.serverUrl = server.trim().replace(/\/$/, '');
                setShowServer(false);
              });
            }}
          >
            <input class="pp-grow" type="url" aria-label="Server URL" value={server} onInput={(e) => setServer((e.target as HTMLInputElement).value)} />
            <button class="pp-btn">Save</button>
          </form>
        )}
        {error && (
          <div class="pp-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
