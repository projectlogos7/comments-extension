import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Membership, Notification } from '@pinpoint/shared';
import { errorMessage, useActiveMembership, useAsync, useDebouncedUiEvents, useUi } from '../context';
import type { Route } from '../router';
import { AllComments } from './AllComments';
import { Avatar, Empty, Icon, Kbd, Menu, Skeleton, type MenuItem } from './common';
import { Inbox } from './Inbox';
import { InviteButton, InvitePanel } from './Invite';
import { Settings, type SettingsTab } from './Settings';
import { ThreadView } from './ThreadView';

/** Remembered invite token: set on the signed-out invite page, accepted right after sign-in. */
export const PENDING_INVITE_KEY = 'pp.pendingInvite';

export function useUnreadCounts(workspaceId?: string | null) {
  const { host } = useUi();
  const [counts, setCounts] = useState({ mentions: 0, notifications: 0 });
  const load = () =>
    host.api
      .unreadCounts(workspaceId ?? undefined)
      .then(setCounts)
      .catch(() => {});
  useEffect(() => {
    load();
  }, [workspaceId]);
  useDebouncedUiEvents((e) => e.kind === 'unread.changed' || e.kind === 'threads.changed', load, [workspaceId], 500);
  return counts;
}

function WorkspaceMark({ name }: { name: string }) {
  return (
    <span class="pp-ws-mark" aria-hidden="true">
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

export function WorkspaceSwitcher() {
  const { host, session, toast } = useUi();
  const ms = session.me?.memberships ?? [];
  const active = useActiveMembership();
  if (!ms.length || !active) return null;
  const items: MenuItem[] = [
    ...ms.map((m: Membership) => ({
      label: m.workspace.name,
      hint: m.workspace.id === active.workspace.id ? 'Current' : m.member.role,
      onSelect: async () => {
        if (m.workspace.id === active.workspace.id) return;
        try {
          await host.setActiveWorkspace(m.workspace.id);
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      },
    })),
    { label: 'New workspace…', icon: 'plus' as const, separator: true, onSelect: () => host.navigate('/onboarding') },
  ];
  return (
    <Menu label="Switch workspace" align="start" buttonClass="pp-ws-switcher" items={items}>
      <WorkspaceMark name={active.workspace.name} />
      <span class="pp-ws-name">{active.workspace.name}</span>
      <Icon name="chevron" size={14} />
    </Menu>
  );
}

export function AppShell({ route, children }: { route: Route; children: ComponentChildren }) {
  const { host, session } = useUi();
  const active = useActiveMembership();
  const counts = useUnreadCounts(active?.workspace.id);
  const section = route.parts[0] ?? 'all';
  const bare = section === 'onboarding' || section === 'invite' || !active;
  const link = (to: string, label: string, icon: Parameters<typeof Icon>[0]['name'], badge?: number) => (
    <a href={`#/${to}`} class={`pp-nav-link ${section === to ? 'pp-active' : ''}`} aria-current={section === to ? 'page' : undefined}>
      <Icon name={icon} size={16} />
      <span>{label}</span>
      {!!badge && (
        <span class="pp-nav-badge" aria-label={`${badge} unread`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </a>
  );
  return (
    <div class="pp-shell">
      <a class="pp-skip" href="#pp-main">
        Skip to content
      </a>
      <header class="pp-topbar">
        <a class="pp-brand" href="#/all" aria-label="Pinpoint home">
          <span class="pp-logo" aria-hidden="true" />
          <span class="pp-brand-name">Pinpoint</span>
        </a>
        {!bare && <span class="pp-topbar-sep" aria-hidden="true" />}
        {!bare && <WorkspaceSwitcher />}
        {!bare && (
          <nav class="pp-nav" aria-label="Main">
            {link('all', 'Comments', 'message')}
            {link('inbox', 'Inbox', 'inbox', counts.notifications)}
            {link('settings', 'Settings', 'settings')}
          </nav>
        )}
        <span class="pp-grow" />
        {!bare && <InviteButton class="pp-btn pp-btn-sm pp-invite-btn" />}
        {session.me && (
          <Menu
            label="Account"
            buttonClass="pp-icon-btn pp-account-btn"
            icon={<Avatar user={session.me.user} size={28} />}
            items={[
              { label: session.me.user.email, disabled: true, onSelect: () => {} },
              { label: 'Account settings', icon: 'settings', separator: true, onSelect: () => host.navigate('/settings/account') },
              { label: 'Sign out', icon: 'logout', onSelect: () => host.signOut() },
            ]}
          />
        )}
      </header>
      <main id="pp-main" class="pp-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

/** Routes shared by the web app and the extension's app page. */
export function AppRoutes({ route }: { route: Route }) {
  const { host } = useUi();
  const active = useActiveMembership();
  const [section, id] = route.parts;
  if (section === 'onboarding') return <Onboarding />;
  if (section === 'invite' && id) return <InviteAccept token={id} />;
  if (!active) return <Onboarding />;
  const ws = active.workspace.id;
  switch (section) {
    case 'thread':
      return (
        <div class="pp-page-narrow">
          <a href="#/all" class="pp-back-link">
            <Icon name="arrowLeft" size={14} /> All comments
          </a>
          <div class="pp-card pp-thread-card">
            <ThreadView key={id} threadId={id} onDeleted={() => host.navigate('/all')} />
          </div>
        </div>
      );
    case 'inbox':
      return (
        <div class="pp-page-narrow">
          <h1 class="pp-h1">Inbox</h1>
          <p class="pp-muted pp-small pp-page-sub">Mentions, replies, assignments and resolved threads.</p>
          <Inbox workspaceId={ws} onOpen={(n: Notification) => host.navigate(`/all?thread=${n.threadId}`)} />
        </div>
      );
    case 'settings':
      return <Settings tab={(id as SettingsTab) || 'workspace'} onTab={(t) => host.navigate(`/settings/${t}`)} />;
    case 'all':
    default:
      return <AllComments workspaceId={ws} threadId={route.query.get('thread')} onSelectThread={(tid) => host.navigate(tid ? `/all?thread=${tid}` : '/all')} />;
  }
}

/** Create workspace → invite teammates (skippable) → ready. */
export function Onboarding() {
  const { host, session, toast } = useUi();
  const [step, setStep] = useState<'create' | 'invite' | 'done'>('create');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [wsId, setWsId] = useState<string | null>(null);
  const [invited, setInvited] = useState(0);
  const hasWorkspaces = (session.me?.memberships.length ?? 0) > 0;
  const first = session.me?.user.name?.split(' ')[0];

  const create = async () => {
    setBusy(true);
    // Keep the flow on this route once the new workspace becomes active.
    host.navigate('/onboarding');
    try {
      const m = await host.api.createWorkspace(name.trim());
      await host.refreshSession();
      await host.setActiveWorkspace(m.workspace.id);
      setWsId(m.workspace.id);
      setStep('invite');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const steps = ['Name your workspace', 'Invite your team', 'Start commenting'];
  const idx = step === 'create' ? 0 : step === 'invite' ? 1 : 2;

  return (
    <div class="pp-onboarding">
      <ol class="pp-steps" aria-label="Setup steps">
        {steps.map((s, i) => (
          <li key={s} class={i < idx ? 'pp-done' : i === idx ? 'pp-current' : ''} aria-current={i === idx ? 'step' : undefined}>
            <span class="pp-step-dot">{i < idx ? <Icon name="check" size={12} /> : i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>

      {step === 'create' && (
        <div class="pp-card pp-onboard-card">
          <h1 class="pp-h1">{first ? `Welcome, ${first}` : 'Welcome to Pinpoint'}</h1>
          <p class="pp-muted">A workspace holds your team, the sites you review and every comment. You can rename it later.</p>
          <form
            class="pp-stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create();
            }}
          >
            <label class="pp-field">
              <span class="pp-field-label">Workspace name</span>
              <input required autoFocus aria-label="Workspace name" placeholder="e.g. Acme web team" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            </label>
            <button class="pp-btn pp-btn-primary pp-btn-lg" disabled={busy || !name.trim()}>
              {busy ? 'Creating…' : 'Continue'}
            </button>
          </form>
          <details class="pp-join-details">
            <summary>Have an invite link instead?</summary>
            <form
              class="pp-row"
              onSubmit={(e) => {
                e.preventDefault();
                const token = invite.trim().replace(/^.*\/invite\//, '').replace(/[#?].*$/, '');
                if (token) host.navigate(`/invite/${token}`);
              }}
            >
              <input class="pp-grow" aria-label="Invite link" placeholder="Paste the invite link" value={invite} onInput={(e) => setInvite((e.target as HTMLInputElement).value)} />
              <button class="pp-btn">Join</button>
            </form>
          </details>
          {hasWorkspaces && (
            <button class="pp-link-btn pp-small" onClick={() => host.navigate('/all')}>
              Cancel
            </button>
          )}
        </div>
      )}

      {step === 'invite' && wsId && (
        <div class="pp-card pp-onboard-card">
          <h1 class="pp-h1">Invite your team</h1>
          <p class="pp-muted">Add the people who review or build your pages. They’ll get an email with a link to join.</p>
          <InvitePanel workspaceId={wsId} compact autoFocus onSent={(i) => setInvited((n) => n + i.length)} />
          <div class="pp-row pp-end pp-onboard-actions">
            <button class="pp-btn pp-btn-ghost" onClick={() => setStep('done')}>
              {invited ? 'Continue' : 'Skip for now'}
            </button>
            {invited > 0 && (
              <button class="pp-btn pp-btn-primary" onClick={() => setStep('done')}>
                Done
              </button>
            )}
          </div>
        </div>
      )}

      {step === 'done' && (
        <div class="pp-card pp-onboard-card">
          <span class="pp-big-check" aria-hidden="true">
            <Icon name="check" size={26} />
          </span>
          <h1 class="pp-h1">You’re all set</h1>
          <ol class="pp-howto">
            <li>
              <strong>{host.isExtension ? 'The extension is installed.' : 'Install the Pinpoint extension'}</strong>
              <span class="pp-muted"> Works in Chrome, Edge, Brave, Opera and Arc.</span>
            </li>
            <li>
              <strong>Open a page</strong> on your site (localhost works out of the box) and press <Kbd>Alt</Kbd>+<Kbd>Shift</Kbd>+<Kbd>C</Kbd>.
            </li>
            <li>
              <strong>Click anything</strong>, write a comment, and mention a teammate with <Kbd>@</Kbd>.
            </li>
          </ol>
          <div class="pp-row pp-end">
            <button class="pp-btn" onClick={() => host.navigate('/settings/workspace')}>
              Add your sites
            </button>
            <button class="pp-btn pp-btn-primary" onClick={() => host.navigate('/all')}>
              Go to comments
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function InviteAccept({ token }: { token: string }) {
  const { host, session, toast } = useUi();
  const { data, error, loading } = useAsync(() => host.api.previewInvite(token), [token]);
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const auto = useRef(false);
  const already = session.me?.memberships.find((m) => m.workspace.name === data?.workspaceName);

  const accept = async () => {
    setBusy(true);
    setJoinError(null);
    try {
      const m = await host.api.acceptInvite(token);
      try {
        sessionStorage.removeItem(PENDING_INVITE_KEY);
      } catch {
        /* storage unavailable */
      }
      await host.refreshSession();
      await host.setActiveWorkspace(m.workspace.id);
      toast(`Welcome to ${m.workspace.name}`, 'success');
      host.navigate('/all');
    } catch (e) {
      setJoinError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Came back from sign-in with this invite pending: join right away.
  useEffect(() => {
    if (auto.current || !data) return;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PENDING_INVITE_KEY);
    } catch {
      /* storage unavailable */
    }
    if (pending === token) {
      auto.current = true;
      accept();
    }
  }, [data]);

  if (loading) return <Skeleton rows={3} />;
  if (error || !data)
    return (
      <div class="pp-page-narrow">
        <div class="pp-card pp-onboard-card">
          <Empty title="This invite link doesn’t work anymore" icon="alert">
            It may have been reset or turned off. Ask the person who invited you for a new link.
          </Empty>
        </div>
      </div>
    );
  return (
    <div class="pp-page-narrow">
      <div class="pp-card pp-onboard-card pp-invite-card">
        <WorkspaceMark name={data.workspaceName} />
        <h1 class="pp-h1">Join {data.workspaceName}</h1>
        <p class="pp-muted">
          You’ve been invited as {data.kind === 'guest' ? 'a guest — you’ll see only what was shared with you' : data.role === 'admin' ? 'an admin' : `a ${data.role}`}.
          {session.me && (
            <>
              {' '}
              You’re signed in as <strong>{session.me.user.email}</strong>.
            </>
          )}
        </p>
        {joinError && (
          <div class="pp-error" role="alert">
            <Icon name="alert" size={16} />
            <span class="pp-grow">{joinError}</span>
          </div>
        )}
        <div class="pp-row pp-end">
          {joinError && (
            <button class="pp-btn" onClick={() => host.signOut()}>
              Use a different account
            </button>
          )}
          {already && !joinError ? (
            <button class="pp-btn pp-btn-primary" onClick={() => host.setActiveWorkspace(already.workspace.id).then(() => host.navigate('/all'))}>
              You’re already a member — open it
            </button>
          ) : (
            <button class="pp-btn pp-btn-primary pp-btn-lg" disabled={busy} onClick={accept}>
              {busy ? 'Joining…' : `Join ${data.workspaceName}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

