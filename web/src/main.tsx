import '@pinpoint/ui/styles.css';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiError, parseAuthFragment } from '@pinpoint/shared';
import { AppRoutes, AppShell, Icon, PENDING_INVITE_KEY, Skeleton, UiProvider, errorMessage, useAsync, useHashRoute, useUi } from '@pinpoint/ui';
import { WebHost } from './webHost';

const host = new WebHost();

/** Path where OAuth / email sign-in redirects land: /app/auth-callback#accessToken=… */
export const AUTH_CALLBACK_PATH = '/app/auth-callback';
/** Page the extension uses as its sign-in redirect; the background reads the tokens from the fragment. */
export const EXTENSION_AUTH_PATH = '/app/extension-auth';
/** Where to go after sign-in when it is outside the app (e.g. a members-only share link). */
const NEXT_KEY = 'pp.next';

function ss(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
  return null;
}

/** Only same-origin share pages and app routes are valid "next" targets (no open redirects). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  if (/^\/share\/[A-Za-z0-9_-]{16,64}$/.test(next)) return next;
  return null;
}

function authRedirect() {
  // Carry "next" in the URL too: email links open in a new tab without this tab's sessionStorage.
  const next = safeNext(ss(NEXT_KEY));
  return `${location.origin}${AUTH_CALLBACK_PATH}${next ? `?next=${encodeURIComponent(next)}` : ''}`;
}

/** After a successful sign-in: leave the app if a share page asked for it. Returns true when navigating away. */
function goNext(): boolean {
  const next = safeNext(ss(NEXT_KEY));
  if (!next) return false;
  ss(NEXT_KEY, null);
  location.href = next;
  return true;
}

/** Handle sign-in landing pages before rendering. Returns a status to show instead of the app, if any. */
function handleLanding(): 'extension' | 'leaving' | null {
  const path = location.pathname.replace(/\/+$/, '');
  if (path.endsWith('/extension-auth') || location.hash.startsWith('#/extension-auth')) return 'extension';
  if (path.endsWith('/auth-callback')) {
    const tokens = parseAuthFragment(location.href);
    if (tokens) host.setTokens(tokens);
    const qNext = safeNext(new URLSearchParams(location.search).get('next'));
    if (qNext) ss(NEXT_KEY, qNext);
    if (tokens && goNext()) return 'leaving';
    const back = ss('pp.returnTo') || '#/all';
    ss('pp.returnTo', null);
    history.replaceState(null, '', `/app/${back}`);
  }
  return null;
}

function Login({ heading, sub }: { heading?: string; sub?: string }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [cfg, setCfg] = useState<{ google: boolean; microsoft: boolean; dev: boolean } | null>(null);
  const [devName, setDevName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/v1/config')
      .then((r) => r.json())
      .then((c) => setCfg(c.providers))
      .catch(() => setCfg({ google: true, microsoft: true, dev: false }));
  }, []);

  const emailLink = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await host.api.emailSignIn(email, authRedirect());
      setSent(email);
      setDevLink(r.devLink ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const devLogin = async (e: Event) => {
    e.preventDefault();
    setError(null);
    try {
      host.setTokens(await host.api.devLogin(email, devName || undefined));
      if (goNext()) return;
      await host.refreshSession();
      location.hash = ss('pp.returnTo') || '#/all';
      ss('pp.returnTo', null);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) setCfg((c) => c && { ...c, dev: false });
      else setError(errorMessage(err));
    }
  };

  return (
    <div class="pp-auth-card">
      <span class="pp-logo pp-logo-lg" aria-hidden="true" />
      <h1 class="pp-h1">{heading ?? 'Sign in to Pinpoint'}</h1>
      <p class="pp-muted">{sub ?? 'Point at any part of a page, comment, and keep your team’s feedback in one place.'}</p>
      {sent ? (
        <div class="pp-sent" role="status">
          <span class="pp-big-check" aria-hidden="true">
            <Icon name="mail" size={22} />
          </span>
          <p>
            Check your inbox — we sent a sign-in link to <strong>{sent}</strong>.
          </p>
          {devLink && (
            <p class="pp-small">
              Development: <a href={devLink}>open the sign-in link</a>
            </p>
          )}
          <button class="pp-link-btn" onClick={() => setSent(null)}>
            Use a different email
          </button>
        </div>
      ) : (
        <>
          {cfg?.google !== false && (
            <a class="pp-btn pp-btn-lg pp-btn-block" href={host.api.oauthStartUrl('google', authRedirect())}>
              Continue with Google
            </a>
          )}
          {cfg?.microsoft !== false && (
            <a class="pp-btn pp-btn-lg pp-btn-block" href={host.api.oauthStartUrl('microsoft', authRedirect())}>
              Continue with Microsoft
            </a>
          )}
          {(cfg?.google !== false || cfg?.microsoft !== false) && <div class="pp-divider">or</div>}
          <form onSubmit={emailLink} class="pp-stack">
            <input type="email" required aria-label="Work email" placeholder="you@company.com" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
            <button class="pp-btn pp-btn-primary pp-btn-lg pp-btn-block" disabled={busy}>
              {busy ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </form>
          {cfg?.dev && (
            <details class="pp-dev-login">
              <summary class="pp-small pp-muted">Developer sign in</summary>
              <form onSubmit={devLogin} class="pp-row" style={{ marginTop: 8 }}>
                <input class="pp-grow" aria-label="Name (optional)" placeholder="Name (optional)" value={devName} onInput={(e) => setDevName((e.target as HTMLInputElement).value)} />
                <button class="pp-btn" disabled={!email}>
                  Dev login
                </button>
              </form>
            </details>
          )}
        </>
      )}
      {error && (
        <div class="pp-error" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

/** Signed-out invite link: show who invited you, then sign in and join automatically. */
function InviteLanding({ token }: { token: string }) {
  const { data, error } = useAsync(() => host.api.previewInvite(token), [token]);
  useEffect(() => {
    ss(PENDING_INVITE_KEY, token);
    ss('pp.returnTo', `#/invite/${token}`);
  }, [token]);
  if (error)
    return (
      <div class="pp-auth-card">
        <h1 class="pp-h1">This invite link doesn’t work anymore</h1>
        <p class="pp-muted">It may have been reset or turned off. Ask the person who invited you for a new link.</p>
      </div>
    );
  if (!data) return <Skeleton rows={3} />;
  return <Login heading={`Join ${data.workspaceName} on Pinpoint`} sub="Sign in to accept your invitation. You’ll join the workspace right after." />;
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

  // "next" from a members-only share page: remember it, and go straight back if already signed in.
  useEffect(() => {
    const next = safeNext(route.query.get('next'));
    if (!next) return;
    ss(NEXT_KEY, next);
    if (host.signedIn) goNext();
  }, [route.query.get('next')]);

  if (route.parts[0] === 'extension-auth') return <ExtensionSignedIn />;
  if (!host.signedIn || route.parts[0] === 'login') {
    if (route.parts[0] === 'invite' && route.parts[1]) return <AuthPage><InviteLanding token={route.parts[1]} /></AuthPage>;
    if (route.parts[0] && route.parts[0] !== 'login') ss('pp.returnTo', location.hash);
    if (host.signedIn && session.me) {
      if (!goNext()) location.hash = '#/all';
      return null;
    }
    return (
      <AuthPage>
        <Login />
      </AuthPage>
    );
  }
  if (booting) return <Skeleton rows={6} />;
  if (bootError && !session.me)
    return (
      <AuthPage>
        <div class="pp-auth-card">
          <div class="pp-error">{bootError}</div>
          <div class="pp-row">
            <button class="pp-btn" onClick={() => location.reload()}>
              Try again
            </button>
            <button class="pp-btn" onClick={() => host.signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </AuthPage>
    );
  return (
    <AppShell route={route}>
      <AppRoutes route={route} />
    </AppShell>
  );
}

function AuthPage({ children }: { children: preact.ComponentChildren }) {
  return <div class="pp-auth">{children}</div>;
}

function ExtensionSignedIn() {
  return (
    <div class="pp-auth">
      <div class="pp-auth-card" role="status">
        <span class="pp-big-check" aria-hidden="true">
          <Icon name="check" size={26} />
        </span>
        <h1 class="pp-h1">You’re signed in</h1>
        <p class="pp-muted">The Pinpoint extension is ready. You can close this tab.</p>
      </div>
    </div>
  );
}

const landing = handleLanding();
const root = document.getElementById('app')!;
if (landing !== 'leaving') {
  render(<UiProvider host={host}>{landing === 'extension' ? <ExtensionSignedIn /> : <App />}</UiProvider>, root);
}
