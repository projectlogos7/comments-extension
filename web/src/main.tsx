import '@pinpoint/ui/styles.css';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiError, parseAuthFragment } from '@pinpoint/shared';
import { AppRoutes, AppShell, Skeleton, UiProvider, errorMessage, useHashRoute, useUi } from '@pinpoint/ui';
import { WebHost } from './webHost';

const host = new WebHost();

/** Path where OAuth / email sign-in redirects land: /app/auth-callback#accessToken=… */
export const AUTH_CALLBACK_PATH = '/app/auth-callback';
/** Page the extension uses as its sign-in redirect; the background reads the tokens from the fragment. */
export const EXTENSION_AUTH_PATH = '/app/extension-auth';

function authRedirect() {
  return `${location.origin}${AUTH_CALLBACK_PATH}`;
}

/** Handle sign-in landing pages before rendering. Returns a status to show instead of the app, if any. */
function handleLanding(): 'extension' | null {
  const path = location.pathname.replace(/\/+$/, '');
  if (path.endsWith('/extension-auth') || location.hash.startsWith('#/extension-auth')) return 'extension';
  if (path.endsWith('/auth-callback')) {
    const tokens = parseAuthFragment(location.href);
    if (tokens) host.setTokens(tokens);
    const back = sessionStorage.getItem('pp.returnTo') || '#/all';
    sessionStorage.removeItem('pp.returnTo');
    history.replaceState(null, '', `/app/${back}`);
  }
  return null;
}

function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [devAvailable, setDevAvailable] = useState(true);
  const [devName, setDevName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const emailLink = async (e: Event) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await host.api.emailSignIn(email, authRedirect());
      setSent(email);
      setDevLink(r.devLink ?? null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const devLogin = async (e: Event) => {
    e.preventDefault();
    setError(null);
    try {
      host.setTokens(await host.api.devLogin(email, devName || undefined));
      await host.refreshSession();
      location.hash = sessionStorage.getItem('pp.returnTo') || '#/all';
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) setDevAvailable(false);
      else setError(errorMessage(err));
    }
  };

  return (
    <div class="pp-auth">
      <div class="pp-auth-card">
        <h1 class="pp-h1">
          <span class="pp-logo" aria-hidden="true">◉</span> Sign in to Pinpoint
        </h1>
        <p class="pp-muted pp-small">Point at any part of a page, comment, and keep your team's feedback in one place.</p>
        <a class="pp-btn" href={host.api.oauthStartUrl('google', authRedirect())}>
          Continue with Google
        </a>
        <a class="pp-btn" href={host.api.oauthStartUrl('microsoft', authRedirect())}>
          Continue with Microsoft
        </a>
        <div class="pp-divider">or</div>
        {sent ? (
          <div role="status">
            <p>
              We sent a sign-in link to <strong>{sent}</strong>.
            </p>
            {devLink && (
              <p class="pp-small">
                Development: <a href={devLink}>open the sign-in link</a>
              </p>
            )}
            <button class="pp-link-btn" onClick={() => setSent(null)}>
              Use another email
            </button>
          </div>
        ) : (
          <form onSubmit={emailLink} class="pp-row">
            <input class="pp-grow" type="email" required aria-label="Work email" placeholder="you@company.com" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
            <button class="pp-btn pp-btn-primary">Email link</button>
          </form>
        )}
        {devAvailable && !sent && (
          <details>
            <summary class="pp-small pp-muted">Developer sign in</summary>
            <form onSubmit={devLogin} class="pp-row" style={{ marginTop: 8 }}>
              <input class="pp-grow" aria-label="Name (optional)" placeholder="Name" value={devName} onInput={(e) => setDevName((e.target as HTMLInputElement).value)} />
              <button class="pp-btn" disabled={!email}>
                Dev login
              </button>
            </form>
          </details>
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

function App() {
  const route = useHashRoute();
  const { session } = useUi();
  const [booting, setBooting] = useState(host.signedIn && !session.me);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    if (!host.signedIn || session.me) return setBooting(false);
    host
      .refreshSession()
      .catch((e) => setBootError(errorMessage(e)))
      .finally(() => setBooting(false));
  }, [host.signedIn]);

  if (route.parts[0] === 'extension-auth') return <ExtensionSignedIn />;
  if (!host.signedIn || route.parts[0] === 'login') {
    if (route.parts[0] && route.parts[0] !== 'login') sessionStorage.setItem('pp.returnTo', location.hash);
    if (host.signedIn && session.me) {
      location.hash = '#/all';
      return null;
    }
    return <Login />;
  }
  if (booting) return <Skeleton rows={6} />;
  if (bootError && !session.me)
    return (
      <div class="pp-auth">
        <div class="pp-auth-card">
          <div class="pp-error">{bootError}</div>
          <button class="pp-btn" onClick={() => location.reload()}>
            Retry
          </button>
          <button class="pp-btn" onClick={() => host.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    );
  return (
    <AppShell route={route}>
      <AppRoutes route={route} />
    </AppShell>
  );
}

function ExtensionSignedIn() {
  return (
    <div class="pp-auth">
      <div class="pp-auth-card" role="status">
        <h1 class="pp-h1">Signed in</h1>
        <p>You're signed in to the Pinpoint extension — you can close this tab.</p>
      </div>
    </div>
  );
}

const landing = handleLanding();
const root = document.getElementById('app')!;
render(
  <UiProvider host={host}>{landing === 'extension' ? <ExtensionSignedIn /> : <App />}</UiProvider>,
  root,
);
