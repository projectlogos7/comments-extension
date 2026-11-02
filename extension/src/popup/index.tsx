// Toolbar popup: the simplest way in. Comment on this page, enable Pinpoint on a site, invite a
// teammate, see unread mentions. First run: sign in, then name a workspace.
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AuthState, ExtEvent, Membership, PageInfo, UnreadCounts, Workspace } from '@pinpoint/shared';
import { can, normalizeSitePattern } from '@pinpoint/shared';
import { api, bg } from '../lib/messaging';
import './popup.css';

const isMac = /Mac/i.test(navigator.platform);

function prettyShortcut(s: string) {
  if (!s) return '';
  return isMac ? s.replace(/Alt\+?/g, '⌥').replace(/Shift\+?/g, '⇧').replace(/Ctrl\+?|Command\+?/g, '⌘').replace(/MacCtrl\+?/g, '⌃') : s;
}

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
      <div class="hero">
        <Logo />
        <h1>Pinpoint</h1>
        <p class="muted">Point at anything on a page, comment, and keep your team in the loop.</p>
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
            setMsg(`Check ${email} for your sign-in link.`);
          });
        }}
      >
        <input aria-label="Work email" type="email" required placeholder="you@company.com" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        <button class="btn primary block" disabled={!!busy}>
          {busy === 'email' ? <Spinner /> : null} Email me a sign-in link
        </button>
      </form>
      {msg && <p class="ok" role="status">{msg}</p>}
      {err && <p class="err" role="alert">{err}</p>}
      <button class="link small" aria-expanded={adv} onClick={() => setAdv(!adv)}>
        {adv ? 'Hide advanced' : 'Advanced'}
      </button>
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
          <label for="dev" class="lbl">Developer sign-in (server with DEV_LOGIN=1)</label>
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

function CreateWorkspace({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      class="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        setErr(null);
        try {
          const m = await api<Membership>('createWorkspace', name.trim());
          await bg({ type: 'workspace.refresh' });
          await bg({ type: 'workspace.setActive', workspaceId: m.workspace.id });
          onDone();
        } catch (e2) {
          setErr((e2 as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div class="hero">
        <Logo />
        <h1>Name your workspace</h1>
        <p class="muted">Your team’s comments live here. You can invite people next.</p>
      </div>
      <input aria-label="Workspace name" placeholder="e.g. Acme Web Team" value={name} onInput={(e) => setName(e.currentTarget.value)} autoFocus />
      <button class="btn primary block" disabled={busy || !name.trim()}>
        {busy ? <Spinner /> : null} Create workspace
      </button>
      {err && <p class="err" role="alert">{err}</p>}
      <p class="muted small center-text">Got an invite? Open the invite link from your email.</p>
    </form>
  );
}

function Invite({ ws, serverUrl }: { ws: Workspace; serverUrl: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  async function copyLink() {
    setErr(null);
    try {
      const w = await api<Workspace>('getWorkspace', ws.id);
      const url = w.inviteToken ? `${serverUrl}/app/#/invite/${w.inviteToken}` : (await api<{ url: string }>('rotateInviteLink', ws.id)).url;
      await navigator.clipboard.writeText(url);
      setMsg('Invite link copied. Anyone with it can join.');
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (!open)
    return (
      <button class="item" onClick={() => setOpen(true)}>
        <span class="item-ico" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16"><path d="M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-4.5 6c0-2.2 2-3.8 4.5-3.8s4.5 1.6 4.5 3.8M12.5 5v4M10.5 7h4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
        </span>
        <span class="grow">Invite teammates</span>
        <span class="chev">›</span>
      </button>
    );

  const emails = email
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div class="invite">
      <form
        class="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!emails.length) return;
          setBusy(true);
          setErr(null);
          setMsg(null);
          try {
            await api('invite', ws.id, emails, 'member');
            setMsg(`Invite sent to ${emails.join(', ')}.`);
            setEmail('');
          } catch (e2) {
            setErr((e2 as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input ref={input} type="text" inputMode="email" aria-label="Emails to invite" placeholder="name@company.com, …" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        <button class="btn primary" disabled={busy || !emails.length}>
          {busy ? <Spinner /> : 'Invite'}
        </button>
      </form>
      <div class="row small">
        <button class="link" onClick={() => void copyLink()}>
          Copy invite link
        </button>
        <span class="grow" />
        <button class="link muted-link" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      {msg && <p class="ok" role="status">{msg}</p>}
      {err && <p class="err" role="alert">{err}</p>}
    </div>
  );
}

function App() {
  const [state, setState] = useState<AuthState | null>(null);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [counts, setCounts] = useState<UnreadCounts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shortcut, setShortcut] = useState<string | null>(null);

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
    chrome.commands
      ?.getAll()
      .then((cmds) => setShortcut(cmds.find((c) => c.name === 'toggle-comment-mode')?.shortcut ?? ''))
      .catch(() => setShortcut(null));
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

  if (!state)
    return (
      <div class="center">
        <Spinner />
      </div>
    );
  if (!state.signedIn || !state.me) return <SignIn state={state} onDone={() => void load()} />;

  const me = state.me;
  const ms = me.memberships.find((m) => m.workspace.id === state.activeWorkspaceId) ?? me.memberships[0];
  if (!ms) return <CreateWorkspace onDone={() => void load()} />;

  const ws = ms.workspace;
  const isAdmin = can(ms.member.role, 'manageSites');
  const isWeb = !!page?.url && /^https?:/.test(page.url);
  const host = isWeb ? new URL(page!.url).host : null;
  const app = (hash: string) => chrome.tabs.create({ url: chrome.runtime.getURL(`app.html#${hash}`) });

  async function command(kind: 'commentMode.start' | 'pageComment.start') {
    setErr(null);
    try {
      await bg({ type: 'tab.command', command: { kind } });
      window.close();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  // Must run synchronously in the click handler: chrome.permissions.request needs the user gesture.
  function enableSite() {
    if (!page || !host) return;
    const u = new URL(page.url);
    const site = normalizeSitePattern(u.hostname);
    setBusy(true);
    setErr(null);
    const granted = chrome.permissions.request({ origins: [`${u.protocol}//${u.hostname}/*`] }).catch(() => false);
    void (async () => {
      try {
        const sites = ws.allowedSites.includes(site) ? ws.allowedSites : [...ws.allowedSites, site];
        await api('updateWorkspace', ws.id, { allowedSites: sites });
        await granted;
        await bg({ type: 'workspace.refresh' });
        await bg({ type: 'permissions.sync' });
        setNote(`Pinpoint is on for ${site}. Comment away!`);
        await load();
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }

  function grantPins() {
    if (!page) return;
    const u = new URL(page.url);
    void chrome.permissions
      .request({ origins: [`${u.protocol}//${u.hostname}/*`] })
      .then(async (ok) => {
        if (ok) {
          await bg({ type: 'permissions.sync' });
          await load();
        }
      })
      .catch((e) => setErr((e as Error).message));
  }

  const threadCount = page?.anchors.length ?? 0;
  const detached = page?.anchors.filter((a) => a.state === 'detached').length ?? 0;

  return (
    <div class="stack">
      <header class="top">
        <Logo small />
        {me.memberships.length > 1 ? (
          <select
            aria-label="Workspace"
            value={ws.id}
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
          <strong class="wsname">{ws.name}</strong>
        )}
        <span class="grow" />
        <button
          class="icon"
          title="Inbox"
          aria-label={`Inbox${counts?.mentions ? `, ${counts.mentions} unread mentions` : ''}`}
          onClick={async () => {
            await bg({ type: 'sidepanel.open' }).catch((e) => setErr((e as Error).message));
            window.close();
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 9.5h3l1 1.5h3l1-1.5h3M3.5 3h9l1 6.5V13h-11V9.5Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /></svg>
          {counts && counts.mentions > 0 ? <span class="badge-dot">{counts.mentions > 9 ? '9+' : counts.mentions}</span> : null}
        </button>
        <button class="icon" title="Settings" aria-label="Settings" onClick={() => app('/settings')}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
        </button>
      </header>

      {!isWeb && page && <div class="notice">Open a website to start commenting. Pinpoint can’t run on browser pages.</div>}

      {isWeb && page && !page.allowed && (
        <div class="enable">
          <div class="enable-title">
            Pinpoint is off on <b>{host}</b>
          </div>
          {isAdmin ? (
            <>
              <p class="muted small">Turn it on to comment here. Everyone in {ws.name} will see comments on this site.</p>
              <button class="btn primary block big" disabled={busy} onClick={enableSite}>
                {busy ? <Spinner /> : null} Enable Pinpoint on {host}
              </button>
            </>
          ) : (
            <p class="muted small">Ask an admin of {ws.name} to add {host} to the allowed sites.</p>
          )}
        </div>
      )}

      {isWeb && page?.allowed && (
        <div class="stack tight">
          <button class="btn primary block big" onClick={() => void command('commentMode.start')}>
            <span class="row">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
              Comment on this page
            </span>
            {shortcut ? <kbd>{prettyShortcut(shortcut)}</kbd> : null}
          </button>
          <div class="row">
            <button class="btn grow" onClick={() => void command('pageComment.start')}>
              Page comment
            </button>
            <button
              class="btn grow"
              disabled={!page.active}
              aria-pressed={page.pinsVisible ?? true}
              onClick={async () => {
                const r = await bg<{ pinsVisible: boolean }>({ type: 'tab.command', command: { kind: 'pins.toggle' } }).catch(() => null);
                if (r) setPage({ ...page, pinsVisible: r.pinsVisible });
              }}
            >
              {page.pinsVisible === false ? 'Show pins' : 'Hide pins'}
            </button>
          </div>
          {page.active ? (
            <p class="muted small">
              {threadCount ? `${threadCount} comment${threadCount === 1 ? '' : 's'} on this page` : 'No comments on this page yet'}
              {detached ? ` · ${detached} need re-attaching` : ''}
            </p>
          ) : !page.hasPermission ? (
            <p class="muted small">
              Pins appear after you comment.{' '}
              <button class="link" onClick={grantPins}>
                Always show pins on {host}
              </button>
            </p>
          ) : null}
        </div>
      )}

      {shortcut === '' && (
        <div class="notice small">
          The keyboard shortcut isn’t set (another extension may use Alt+Shift+C).{' '}
          <button class="link" onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
            Set shortcut
          </button>
        </div>
      )}

      {note && <p class="ok" role="status">{note}</p>}
      {err && <p class="err" role="alert">{err}</p>}

      <nav class="list" aria-label="Pinpoint">
        <button
          class="item"
          onClick={async () => {
            await bg({ type: 'sidepanel.open' }).catch((e) => setErr((e as Error).message));
            window.close();
          }}
        >
          <span class="item-ico" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M10 2.5v11" stroke="currentColor" stroke-width="1.4" /></svg>
          </span>
          <span class="grow">Comments & inbox</span>
          {counts && counts.mentions > 0 ? (
            <span class="badge" aria-label={`${counts.mentions} unread mentions`}>
              {counts.mentions}
            </span>
          ) : (
            <span class="chev">›</span>
          )}
        </button>
        <button class="item" onClick={() => app('/all')}>
          <span class="item-ico" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
          </span>
          <span class="grow">All comments</span>
          <span class="chev">›</span>
        </button>
        {can(ms.member.role, 'manageMembers') && <Invite ws={ws} serverUrl={state.serverUrl} />}
      </nav>

      <footer class="foot">
        <span class={`dot ${state.online ? 'on' : 'off'}`} aria-hidden="true" />
        <span class="muted small grow ellipsis" title={me.user.email}>
          {state.online ? '' : 'Offline · '}
          {state.pendingWrites ? `${state.pendingWrites} waiting to sync · ` : ''}
          {me.user.email}
        </span>
        <button
          class="link small"
          onClick={async () => {
            await bg({ type: 'auth.signOut' });
            await load();
          }}
        >
          Sign out
        </button>
      </footer>
    </div>
  );
}

function Logo({ small }: { small?: boolean }) {
  const s = small ? 22 : 40;
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
