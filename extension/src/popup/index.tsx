// Toolbar popup: sign in, workspace switcher, start comment mode, pins toggle, unread mentions,
// site access, sync status.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AuthState, ExtEvent, PageInfo, UnreadCounts } from '@pinpoint/shared';
import { LOCALHOST_MATCH_PATTERNS, sitePatternToMatchPatterns } from '@pinpoint/shared';
import { bg } from '../lib/messaging';
import './popup.css';

const isMac = /Mac/i.test(navigator.platform);
const SHORTCUT = isMac ? '⌥⇧C' : 'Alt+Shift+C';

function Spinner() {
  return <span class="spin" aria-hidden="true" />;
}

function SignIn({ state, onDone }: { state: AuthState; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adv, setAdv] = useState(false);
  const [server, setServer] = useState(state.serverUrl);
  const [devEmail, setDevEmail] = useState('');

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class="stack">
      <div class="brand">
        <Logo />
        <div>
          <h1>Pinpoint</h1>
          <p class="muted">Comment on any part of a page, together.</p>
        </div>
      </div>
      <button class="btn block" disabled={!!busy} onClick={() => run('google', () => bg({ type: 'auth.signIn', provider: 'google' }))}>
        {busy === 'google' ? <Spinner /> : <GoogleIcon />} Continue with Google
      </button>
      <button class="btn block" disabled={!!busy} onClick={() => run('microsoft', () => bg({ type: 'auth.signIn', provider: 'microsoft' }))}>
        {busy === 'microsoft' ? <Spinner /> : <MsIcon />} Continue with Microsoft
      </button>
      <div class="or">or</div>
      <form
        class="stack tight"
        onSubmit={(e) => {
          e.preventDefault();
          if (!email) return;
          void run('email', async () => {
            await bg({ type: 'auth.emailSignIn', email });
            setMsg(`Check ${email} for a sign-in link. This popup can be closed.`);
          });
        }}
      >
        <label for="email" class="lbl">Work email</label>
        <input id="email" type="email" required placeholder="you@company.com" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        <button class="btn primary block" disabled={!!busy}>{busy === 'email' ? <Spinner /> : null} Email me a sign-in link</button>
      </form>
      {msg && <p class="ok" role="status">{msg}</p>}
      {err && <p class="err" role="alert">{err}</p>}
      <button class="link" aria-expanded={adv} onClick={() => setAdv(!adv)}>{adv ? '▾' : '▸'} Advanced</button>
      {adv && (
        <div class="stack tight panel">
          <label for="srv" class="lbl">Server URL</label>
          <div class="row">
            <input id="srv" type="url" value={server} onInput={(e) => setServer(e.currentTarget.value)} />
            <button
              class="btn"
              onClick={() =>
                run('server', async () => {
                  const origin = new URL(server).origin;
                  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
                    const ok = await chrome.permissions.request({ origins: [`${origin}/*`] });
                    if (!ok) throw new Error('Pinpoint needs permission to reach that server.');
                  }
                  await bg({ type: 'settings.setServerUrl', serverUrl: origin });
                  setMsg(`Server set to ${origin}`);
                })
              }
            >
              Save
            </button>
          </div>
          <label for="dev" class="lbl">Developer sign-in (servers with DEV_LOGIN=1)</label>
          <div class="row">
            <input id="dev" type="email" placeholder="dev@example.com" value={devEmail} onInput={(e) => setDevEmail(e.currentTarget.value)} />
            <button class="btn" disabled={!devEmail || !!busy} onClick={() => run('dev', () => bg({ type: 'auth.devSignIn', email: devEmail }))}>
              Sign in
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [state, setState] = useState<AuthState | null>(null);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [counts, setCounts] = useState<UnreadCounts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const s = await bg<AuthState>({ type: 'auth.state' });
      setState(s);
      if (s.signedIn) {
        bg<PageInfo>({ type: 'page.info' }).then(setPage, () => setPage(null));
        bg<UnreadCounts>({ type: 'badge.refresh' }).then(setCounts, () => undefined);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    const l = (m: ExtEvent) => {
      if (m?.type === 'auth.changed') {
        setState(m.state);
        if (m.state.signedIn) void load();
      } else if (m?.type === 'unread.changed') setCounts(m.counts);
      else if (m?.type === 'sync.status') setState((s) => (s ? { ...s, pendingWrites: m.pendingWrites, online: m.online } : s));
    };
    chrome.runtime.onMessage.addListener(l);
    return () => chrome.runtime.onMessage.removeListener(l);
  }, []);

  if (!state) return <div class="center"><Spinner /></div>;
  if (!state.signedIn || !state.me) return <SignIn state={state} onDone={() => void load()} />;

  const me = state.me;
  const ws = me.memberships.find((m) => m.workspace.id === state.activeWorkspaceId) ?? me.memberships[0];
  const host = page?.url && /^https?:/.test(page.url) ? new URL(page.url).host : null;

  async function command(kind: 'commentMode.start' | 'pageComment.start') {
    setErr(null);
    try {
      await bg({ type: 'tab.command', command: { kind } });
      window.close();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function grant(all: boolean) {
    setBusy(true);
    setErr(null);
    try {
      let origins: string[];
      if (all && ws) origins = [...LOCALHOST_MATCH_PATTERNS, ...ws.workspace.allowedSites.flatMap(sitePatternToMatchPatterns)];
      else {
        const u = new URL(page!.url);
        origins = [`${u.protocol}//${u.hostname}/*`];
      }
      const ok = await chrome.permissions.request({ origins });
      if (!ok) throw new Error('Access was not granted.');
      await bg({ type: 'permissions.sync' });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const app = (hash: string) => chrome.tabs.create({ url: chrome.runtime.getURL(`app.html#${hash}`) });

  return (
    <div class="stack">
      <header class="top">
        <Logo small />
        {me.memberships.length > 1 ? (
          <select
            aria-label="Workspace"
            value={ws?.workspace.id}
            onChange={async (e) => {
              await bg({ type: 'workspace.setActive', workspaceId: e.currentTarget.value });
              await load();
            }}
          >
            {me.memberships.map((m) => (
              <option value={m.workspace.id}>{m.workspace.name}</option>
            ))}
          </select>
        ) : (
          <strong class="wsname">{ws?.workspace.name ?? 'No workspace'}</strong>
        )}
        <span class="grow" />
        <button class="icon" title="Settings" aria-label="Settings" onClick={() => app('/settings')}>⚙</button>
      </header>

      {!ws && (
        <div class="notice">
          You are not in a workspace yet. <button class="link" onClick={() => app('/onboarding')}>Create or join one</button>
        </div>
      )}

      {ws && page && host && !page.allowed && (
        <div class="notice">
          <b>{host}</b> is not on {ws.workspace.name}’s allowed sites, so Pinpoint stays inactive here.{' '}
          {['owner', 'admin'].includes(ws.member.role) ? <button class="link" onClick={() => app('/settings/sites')}>Manage allowed sites</button> : 'Ask an admin to add it.'}
        </div>
      )}

      {ws && page && page.allowed && !page.hasPermission && !page.active && (
        <div class="notice">
          Pinpoint needs your permission to show comments on <b>{host}</b>.
          <div class="row" style="margin-top:8px">
            <button class="btn primary" disabled={busy} onClick={() => void grant(false)}>Grant access to {host}</button>
            <button class="btn" disabled={busy} onClick={() => void grant(true)}>All allowed sites</button>
          </div>
        </div>
      )}

      {ws && (
        <div class="stack tight">
          <button class="btn primary block big" disabled={!page?.allowed} onClick={() => void command('commentMode.start')}>
            <span>💬 Comment on this page</span>
            <kbd>{SHORTCUT}</kbd>
          </button>
          <div class="row">
            <button class="btn grow" disabled={!page?.allowed} onClick={() => void command('pageComment.start')}>Page comment</button>
            <button
              class="btn grow"
              disabled={!page?.active}
              aria-pressed={page?.pinsVisible ?? true}
              onClick={async () => {
                const r = await bg<{ pinsVisible: boolean }>({ type: 'tab.command', command: { kind: 'pins.toggle' } }).catch(() => null);
                if (r && page) setPage({ ...page, pinsVisible: r.pinsVisible });
              }}
            >
              {page?.pinsVisible === false ? 'Show pins' : 'Hide pins'}
            </button>
          </div>
          {page?.active && (
            <p class="muted small">
              {page.anchors.length} thread{page.anchors.length === 1 ? '' : 's'} on this page
              {page.anchors.some((a) => a.state === 'detached') ? ` · ${page.anchors.filter((a) => a.state === 'detached').length} detached` : ''}
            </p>
          )}
        </div>
      )}

      {ws && (
        <nav class="list" aria-label="Pinpoint">
          <button
            class="item"
            onClick={async () => {
              await bg({ type: 'sidepanel.open' }).catch((e) => setErr((e as Error).message));
              window.close();
            }}
          >
            <span>Inbox & page threads</span>
            {counts && counts.mentions > 0 ? <span class="badge" aria-label={`${counts.mentions} unread mentions`}>{counts.mentions}</span> : <span class="chev">›</span>}
          </button>
          <button class="item" onClick={() => app('/all')}>
            <span>All comments</span>
            <span class="chev">›</span>
          </button>
        </nav>
      )}

      {err && <p class="err" role="alert">{err}</p>}

      <footer class="foot">
        <span class={`dot ${state.online ? 'on' : 'off'}`} aria-hidden="true" />
        <span class="muted small grow">
          {state.online ? 'Connected' : 'Offline'}
          {state.pendingWrites ? ` · ${state.pendingWrites} waiting to sync` : ''} · {me.user.email}
        </span>
        <button class="link small" onClick={async () => { await bg({ type: 'auth.signOut' }); await load(); }}>Sign out</button>
      </footer>
    </div>
  );
}

function Logo({ small }: { small?: boolean }) {
  const s = small ? 22 : 36;
  return (
    <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2c-6.1 0-11 4.9-11 11 0 8.2 11 17 11 17s11-8.8 11-17c0-6.1-4.9-11-11-11z" fill="#5B5BD6" />
      <circle cx="16" cy="13" r="4.5" fill="#fff" />
    </svg>
  );
}
function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
function MsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 23 23" aria-hidden="true">
      <path fill="#f35325" d="M1 1h10v10H1z" />
      <path fill="#81bc06" d="M12 1h10v10H12z" />
      <path fill="#05a6f0" d="M1 12h10v10H1z" />
      <path fill="#ffba08" d="M12 12h10v10H12z" />
    </svg>
  );
}

render(<App />, document.getElementById('app')!);
