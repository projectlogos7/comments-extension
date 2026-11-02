import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Notification } from '@pinpoint/shared';
import { errorMessage, useActiveMembership, useAsync, useUi, useUiEvents } from '../context';
import type { Route } from '../router';
import { AllComments } from './AllComments';
import { Avatar, Empty, ErrorBox, Menu, Skeleton } from './common';
import { Inbox } from './Inbox';
import { Settings, type SettingsTab } from './Settings';
import { ThreadView } from './ThreadView';

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
  useUiEvents((e) => {
    if (e.kind === 'unread.changed' || e.kind === 'threads.changed') load();
  }, [workspaceId]);
  return counts;
}

export function WorkspaceSwitcher() {
  const { host, session, toast } = useUi();
  const ms = session.me?.memberships ?? [];
  const active = useActiveMembership();
  if (!ms.length) return null;
  return (
    <select
      class="pp-ws-switcher"
      aria-label="Workspace"
      value={active?.workspace.id ?? ''}
      onChange={async (e) => {
        const id = (e.target as HTMLSelectElement).value;
        if (id === '__new') {
          host.navigate('/onboarding');
          return;
        }
        try {
          await host.setActiveWorkspace(id);
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      }}
    >
      {ms.map((m) => (
        <option key={m.workspace.id} value={m.workspace.id}>
          {m.workspace.name}
        </option>
      ))}
      <option value="__new">+ New workspace…</option>
    </select>
  );
}

export function AppShell({ route, children }: { route: Route; children: ComponentChildren }) {
  const { host, session } = useUi();
  const active = useActiveMembership();
  const counts = useUnreadCounts(active?.workspace.id);
  const section = route.parts[0] ?? 'all';
  const link = (to: string, label: string, badge?: number) => (
    <a href={`#/${to}`} class={`pp-nav-link ${section === to ? 'pp-active' : ''}`} aria-current={section === to ? 'page' : undefined}>
      {label}
      {!!badge && <span class="pp-nav-badge" aria-label={`${badge} unread`}>{badge}</span>}
    </a>
  );
  return (
    <div class="pp-shell">
      <a class="pp-skip" href="#pp-main">
        Skip to content
      </a>
      <header class="pp-topbar">
        <a class="pp-brand" href="#/all">
          <span class="pp-logo" aria-hidden="true">◉</span> Pinpoint
        </a>
        <WorkspaceSwitcher />
        <nav class="pp-nav" aria-label="Main">
          {link('all', 'All comments')}
          {link('inbox', 'Inbox', counts.notifications)}
          {link('settings', 'Settings')}
        </nav>
        <span class="pp-grow" />
        {session.me && (
          <Menu
            label="Account"
            buttonClass="pp-icon-btn pp-account-btn"
            icon={<Avatar user={session.me.user} size={28} />}
            items={[
              { label: 'Account settings', onSelect: () => host.navigate('/settings/account') },
              { label: 'Sign out', onSelect: () => host.signOut() },
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
          <a href="#/all" class="pp-link-btn">
            ← All comments
          </a>
          <ThreadView key={id} threadId={id} onDeleted={() => host.navigate('/all')} />
        </div>
      );
    case 'inbox':
      return (
        <div class="pp-page-narrow">
          <h1 class="pp-h1">Inbox</h1>
          <Inbox workspaceId={ws} onOpen={(n: Notification) => host.navigate(`/thread/${n.threadId}`)} />
        </div>
      );
    case 'settings':
      return <Settings tab={(id as SettingsTab) || 'workspace'} onTab={(t) => host.navigate(`/settings/${t}`)} />;
    case 'all':
    default:
      return <AllComments workspaceId={ws} threadId={route.query.get('thread')} onSelectThread={(tid) => host.navigate(tid ? `/all?thread=${tid}` : '/all')} />;
  }
}

export function Onboarding() {
  const { host, session, toast } = useUi();
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const m = await host.api.createWorkspace(name.trim());
      await host.refreshSession();
      await host.setActiveWorkspace(m.workspace.id);
      host.navigate('/settings/workspace');
      toast('Workspace created — add the sites you want to review', 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="pp-page-narrow pp-onboarding">
      <h1 class="pp-h1">Welcome{session.me ? `, ${session.me.user.name.split(' ')[0]}` : ''}</h1>
      <p class="pp-muted">Create a workspace for your team, or join one with an invite.</p>
      <form
        class="pp-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create();
        }}
      >
        <h2>Create a workspace</h2>
        <div class="pp-row">
          <input class="pp-grow" required aria-label="Workspace name" placeholder="Acme web team" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <button class="pp-btn pp-btn-primary" disabled={busy}>
            Create
          </button>
        </div>
      </form>
      <form
        class="pp-card"
        onSubmit={(e) => {
          e.preventDefault();
          const token = invite.trim().replace(/^.*\/invite\//, '').replace(/[#?].*$/, '');
          if (token) host.navigate(`/invite/${token}`);
        }}
      >
        <h2>Join with an invite</h2>
        <div class="pp-row">
          <input class="pp-grow" aria-label="Invite link or code" placeholder="Paste an invite link" value={invite} onInput={(e) => setInvite((e.target as HTMLInputElement).value)} />
          <button class="pp-btn">Continue</button>
        </div>
      </form>
    </div>
  );
}

export function InviteAccept({ token }: { token: string }) {
  const { host, toast } = useUi();
  const { data, error, loading } = useAsync(() => host.api.previewInvite(token), [token]);
  const [busy, setBusy] = useState(false);
  if (loading) return <Skeleton rows={3} />;
  if (error) return <div class="pp-page-narrow"><ErrorBox error={error} /></div>;
  if (!data) return <Empty title="Invite not found" />;
  return (
    <div class="pp-page-narrow">
      <div class="pp-card">
        <h1 class="pp-h1">Join {data.workspaceName}</h1>
        <p class="pp-muted">
          You've been invited as {data.kind === 'guest' ? 'a guest' : `a ${data.role}`}.
        </p>
        <button
          class="pp-btn pp-btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const m = await host.api.acceptInvite(token);
              await host.refreshSession();
              await host.setActiveWorkspace(m.workspace.id);
              toast(`Joined ${m.workspace.name}`, 'success');
              host.navigate('/all');
            } catch (e) {
              toast(errorMessage(e), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Accept invite
        </button>
      </div>
    </div>
  );
}
