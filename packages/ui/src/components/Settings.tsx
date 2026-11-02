import { useEffect, useState } from 'preact/hooks';
import {
  can,
  canChangeRole,
  defaultNotificationPrefs,
  NOTIFICATION_EVENTS,
  normalizeSitePattern,
  type IntegrationConfig,
  type IntegrationKind,
  type Member,
  type NotificationPrefs,
  type Role,
  type WebhookEvent,
  type Workspace,
} from '@pinpoint/shared';
import { errorMessage, useActiveMembership, useAsync, useUi } from '../context';
import { webAppUrl } from '../host';
import { Avatar, capitalize, downloadBlob, Empty, ErrorBox, Field, RelTime, Skeleton, Toggle } from './common';

export type SettingsTab = 'workspace' | 'members' | 'notifications' | 'integrations' | 'developer' | 'account';

const TABS: { id: SettingsTab; label: string; admin?: boolean }[] = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'members', label: 'Members' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'integrations', label: 'Integrations', admin: true },
  { id: 'developer', label: 'API & webhooks', admin: true },
  { id: 'account', label: 'Account' },
];

export function Settings({ tab, onTab }: { tab: SettingsTab; onTab: (t: SettingsTab) => void }) {
  const membership = useActiveMembership();
  if (!membership) return <Empty title="No workspace">Create or join a workspace first.</Empty>;
  const role = membership.member.role;
  const isAdmin = can(role, 'manageMembers');
  const tabs = TABS.filter((t) => !t.admin || isAdmin);
  return (
    <div class="pp-settings">
      <nav class="pp-tabs" role="tablist" aria-label="Settings sections">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} class={tab === t.id ? 'pp-active' : ''} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div class="pp-settings-body" role="tabpanel">
        {tab === 'workspace' && <WorkspaceSettings workspaceId={membership.workspace.id} role={role} />}
        {tab === 'members' && <MembersSettings workspaceId={membership.workspace.id} role={role} />}
        {tab === 'notifications' && <NotificationSettings workspaceId={membership.workspace.id} member={membership.member} />}
        {tab === 'integrations' && isAdmin && <IntegrationSettings workspaceId={membership.workspace.id} />}
        {tab === 'developer' && isAdmin && <DeveloperSettings workspaceId={membership.workspace.id} />}
        {tab === 'account' && <AccountSettings />}
      </div>
    </div>
  );
}

function useSaver() {
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok = 'Saved') => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok, 'success');
      return true;
    } catch (e) {
      toast(errorMessage(e), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

// ---------------- workspace ----------------

export function WorkspaceSettings({ workspaceId, role }: { workspaceId: string; role: Role }) {
  const { host, confirm } = useUi();
  const { data: ws, error, loading, reload, setData } = useAsync(() => host.api.getWorkspace(workspaceId), [workspaceId]);
  const [draft, setDraft] = useState<Workspace | null>(null);
  const [newSite, setNewSite] = useState('');
  const { busy, run } = useSaver();
  useEffect(() => setDraft(ws ?? null), [ws]);
  if (loading && !ws) return <Skeleton rows={6} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!draft) return null;
  const canSites = can(role, 'manageSites');
  const canShare = can(role, 'manageSharing');

  const save = () =>
    run(async () => {
      const next = await host.api.updateWorkspace(workspaceId, {
        name: draft.name,
        allowedSites: draft.allowedSites,
        linkSharing: draft.linkSharing,
        emailDomain: draft.emailDomain || null,
        privacy: draft.privacy,
      });
      setData(next);
      await host.refreshSession();
    });

  const addSite = () => {
    const s = normalizeSitePattern(newSite);
    if (!s || draft.allowedSites.includes(s)) return;
    setDraft({ ...draft, allowedSites: [...draft.allowedSites, s] });
    setNewSite('');
  };

  return (
    <form
      class="pp-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h2>General</h2>
      <Field label="Workspace name">
        <input value={draft.name} disabled={!canSites} onInput={(e) => setDraft({ ...draft, name: (e.target as HTMLInputElement).value })} />
      </Field>

      <h2>Allowed sites</h2>
      <p class="pp-muted pp-small">Pinpoint only runs on these sites (plus localhost). Use *.example.com for subdomains.</p>
      <ul class="pp-chip-list">
        {draft.allowedSites.map((s) => (
          <li key={s} class="pp-chip">
            {s}
            {canSites && (
              <button type="button" class="pp-icon-btn pp-icon-sm" aria-label={`Remove ${s}`} onClick={() => setDraft({ ...draft, allowedSites: draft.allowedSites.filter((x) => x !== s) })}>
                ×
              </button>
            )}
          </li>
        ))}
        {!draft.allowedSites.length && <li class="pp-muted pp-small">No sites yet — only localhost is enabled.</li>}
      </ul>
      {canSites && (
        <div class="pp-row">
          <input
            placeholder="staging.example.com"
            aria-label="Add site"
            value={newSite}
            onInput={(e) => setNewSite((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addSite();
              }
            }}
          />
          <button type="button" class="pp-btn" onClick={addSite}>
            Add site
          </button>
        </div>
      )}

      <h2>Sharing &amp; access</h2>
      <Field label="Share links" hint="Who can open a thread's share link">
        <select disabled={!canShare} value={draft.linkSharing} onChange={(e) => setDraft({ ...draft, linkSharing: (e.target as HTMLSelectElement).value as Workspace['linkSharing'] })}>
          <option value="members">Workspace members only</option>
          <option value="anyone">Anyone with the link</option>
        </select>
      </Field>
      <Field label="Restrict joining to email domain" hint="e.g. example.com — leave empty to allow any">
        <input disabled={!canShare} value={draft.emailDomain ?? ''} onInput={(e) => setDraft({ ...draft, emailDomain: (e.target as HTMLInputElement).value.trim() || null })} />
      </Field>

      <h2>Privacy</h2>
      <Toggle checked={draft.privacy.allowFullPage} label="Allow full-page snapshots" onChange={(v) => canShare && setDraft({ ...draft, privacy: { ...draft.privacy, allowFullPage: v } })} />
      <Toggle checked={draft.privacy.allowDom} label="Allow DOM snapshots (HTML and styles)" onChange={(v) => canShare && setDraft({ ...draft, privacy: { ...draft.privacy, allowDom: v } })} />
      <Toggle checked={draft.privacy.requireBlurReview} label="Require blur review before saving snapshots" onChange={(v) => canShare && setDraft({ ...draft, privacy: { ...draft.privacy, requireBlurReview: v } })} />
      <Field label="Snapshot retention (days)" hint="Leave empty to keep snapshots forever">
        <input
          type="number"
          min={1}
          disabled={!canShare}
          value={draft.privacy.snapshotRetentionDays ?? ''}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setDraft({ ...draft, privacy: { ...draft.privacy, snapshotRetentionDays: v ? Math.max(1, Number(v)) : null } });
          }}
        />
      </Field>

      {(canSites || canShare) && (
        <div class="pp-row pp-end">
          <button type="submit" class="pp-btn pp-btn-primary" disabled={busy}>
            Save changes
          </button>
        </div>
      )}

      {can(role, 'deleteWorkspace') && (
        <div class="pp-danger-zone">
          <h2>Delete workspace</h2>
          <p class="pp-muted pp-small">Deletes every thread, comment and snapshot. This cannot be undone.</p>
          <button
            type="button"
            class="pp-btn pp-btn-danger"
            onClick={async () => {
              if (!(await confirm({ title: `Delete "${draft.name}"?`, body: 'All comments and snapshots will be removed for everyone.', confirmLabel: 'Delete workspace', danger: true }))) return;
              await run(async () => {
                await host.api.deleteWorkspace(workspaceId);
                await host.refreshSession();
              }, 'Workspace deleted');
            }}
          >
            Delete workspace
          </button>
        </div>
      )}
    </form>
  );
}

// ---------------- members ----------------

export function MembersSettings({ workspaceId, role }: { workspaceId: string; role: Role }) {
  const { host, confirm, toast, session, membersCache } = useUi();
  const isAdmin = can(role, 'manageMembers');
  const { data: members, error, loading, reload } = useAsync(() => host.api.listMembers(workspaceId), [workspaceId]);
  const { data: invites = [], reload: reloadInvites } = useAsync(() => (isAdmin ? host.api.listInvites(workspaceId) : Promise.resolve([])), [workspaceId, isAdmin]);
  const { data: ws, setData: setWs } = useAsync(() => host.api.getWorkspace(workspaceId), [workspaceId]);
  const { data: grants = [], reload: reloadGrants } = useAsync(() => (isAdmin ? host.api.listGuestGrants(workspaceId) : Promise.resolve([])), [workspaceId, isAdmin]);
  const [emails, setEmails] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('member');
  const [guestThreads, setGuestThreads] = useState('');
  const { busy, run } = useSaver();
  const meId = session.me?.user.id;

  useEffect(() => {
    if (members) membersCache.set(workspaceId, members);
  }, [members]);

  if (loading && !members) return <Skeleton rows={6} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const inviteUrl = ws?.inviteToken ? webAppUrl(host.serverUrl, `/invite/${ws.inviteToken}`) : null;

  const changeRole = (m: Member, next: Role) => run(async () => (await host.api.updateMember(workspaceId, m.id, { role: next }), reload()), 'Role updated');
  const remove = async (m: Member) => {
    const self = m.userId === meId;
    if (!(await confirm({ title: self ? 'Leave this workspace?' : `Remove ${m.user.name || m.user.email}?`, confirmLabel: self ? 'Leave' : 'Remove', danger: true }))) return;
    await run(async () => {
      await host.api.removeMember(workspaceId, m.id);
      if (self) await host.refreshSession();
      else reload();
    }, self ? 'You left the workspace' : 'Member removed');
  };

  return (
    <div class="pp-form">
      <h2>Members</h2>
      <ul class="pp-member-list" role="list">
        {(members ?? []).map((m) => (
          <li key={m.id} class="pp-member">
            <Avatar user={m.user} size={28} />
            <span class="pp-row-body">
              <strong>
                {m.user.name || m.user.email}
                {m.userId === meId ? ' (you)' : ''}
              </strong>
              <span class="pp-muted pp-small">{m.user.email}</span>
            </span>
            {isAdmin && m.userId !== meId ? (
              <select aria-label={`Role for ${m.user.name}`} value={m.role} disabled={busy} onChange={(e) => changeRole(m, (e.target as HTMLSelectElement).value as Role)}>
                {(['owner', 'admin', 'member', 'guest'] as Role[]).map((r) => (
                  <option key={r} value={r} disabled={!canChangeRole(role, m.role, r)}>
                    {capitalize(r)}
                  </option>
                ))}
              </select>
            ) : (
              <span class="pp-badge">{capitalize(m.role)}</span>
            )}
            {(m.userId === meId ? m.role !== 'owner' : isAdmin && canChangeRole(role, m.role, m.role)) && (
              <button class="pp-btn pp-btn-sm" onClick={() => remove(m)}>
                {m.userId === meId ? 'Leave' : 'Remove'}
              </button>
            )}
          </li>
        ))}
      </ul>

      {isAdmin && (
        <>
          <h2>Invite by email</h2>
          <form
            class="pp-row pp-wrap"
            onSubmit={async (e) => {
              e.preventDefault();
              const list = emails
                .split(/[\s,;]+/)
                .map((s) => s.trim())
                .filter((s) => /.+@.+\..+/.test(s));
              if (!list.length) return toast('Enter at least one email', 'error');
              if (await run(() => host.api.invite(workspaceId, list, inviteRole), `Invited ${list.length}`)) {
                setEmails('');
                reloadInvites();
              }
            }}
          >
            <input class="pp-grow" aria-label="Emails to invite" placeholder="ana@example.com, bo@example.com" value={emails} onInput={(e) => setEmails((e.target as HTMLInputElement).value)} />
            <select aria-label="Role" value={inviteRole} onChange={(e) => setInviteRole((e.target as HTMLSelectElement).value as Role)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button class="pp-btn pp-btn-primary" disabled={busy}>
              Send invites
            </button>
          </form>
          {invites.filter((i) => !i.acceptedAt).length > 0 && (
            <ul class="pp-simple-list">
              {invites
                .filter((i) => !i.acceptedAt)
                .map((i) => (
                  <li key={i.id}>
                    <span class="pp-grow">
                      {i.email} · {capitalize(i.role)} · <RelTime iso={i.createdAt} />
                    </span>
                    <button class="pp-link-btn" onClick={() => run(async () => (await host.api.revokeInvite(workspaceId, i.id), reloadInvites()), 'Invite revoked')}>
                      Revoke
                    </button>
                  </li>
                ))}
            </ul>
          )}

          <h2>Invite link</h2>
          <p class="pp-muted pp-small">Anyone with this link can join as a member{ws?.emailDomain ? ` (only @${ws.emailDomain} emails)` : ''}.</p>
          <div class="pp-row pp-wrap">
            {inviteUrl ? (
              <>
                <input class="pp-grow" readOnly value={inviteUrl} aria-label="Invite link" onFocus={(e) => (e.target as HTMLInputElement).select()} />
                <button class="pp-btn" onClick={() => host.copy(inviteUrl).then(() => toast('Invite link copied', 'success'))}>
                  Copy
                </button>
                <button class="pp-btn" onClick={() => run(async () => ws && setWs({ ...ws, inviteToken: (await host.api.rotateInviteLink(workspaceId)).token }), 'New link created')}>
                  Reset
                </button>
                <button class="pp-btn pp-btn-danger" onClick={() => run(async () => (await host.api.disableInviteLink(workspaceId), ws && setWs({ ...ws, inviteToken: null })), 'Invite link disabled')}>
                  Disable
                </button>
              </>
            ) : (
              <button class="pp-btn" onClick={() => run(async () => ws && setWs({ ...ws, inviteToken: (await host.api.rotateInviteLink(workspaceId)).token }), 'Invite link created')}>
                Create invite link
              </button>
            )}
          </div>

          <h2>Guest links</h2>
          <p class="pp-muted pp-small">Guests can comment on the threads or pages you share with them, without full access.</p>
          <form
            class="pp-row pp-wrap"
            onSubmit={async (e) => {
              e.preventDefault();
              const ids = guestThreads.split(/[\s,]+/).filter(Boolean);
              const threadIds = ids.filter((s) => !s.startsWith('page:'));
              const pageIds = ids.filter((s) => s.startsWith('page:')).map((s) => s.slice(5));
              if (!ids.length) return toast('Enter thread IDs or page:<id>', 'error');
              await run(async () => {
                const g = await host.api.createGuestGrant(workspaceId, { threadIds, pageIds });
                await host.copy(g.url);
                setGuestThreads('');
                reloadGrants();
              }, 'Guest link copied');
            }}
          >
            <input class="pp-grow" aria-label="Thread IDs or page:<id>" placeholder="thread ids, or page:<page id>, comma separated" value={guestThreads} onInput={(e) => setGuestThreads((e.target as HTMLInputElement).value)} />
            <button class="pp-btn">Create guest link</button>
          </form>
          {grants.filter((g) => !g.revokedAt).length > 0 && (
            <ul class="pp-simple-list">
              {grants
                .filter((g) => !g.revokedAt)
                .map((g) => (
                  <li key={g.id}>
                    <span class="pp-grow">
                      {g.threadIds.length} thread(s), {g.pageIds.length} page(s) · <RelTime iso={g.createdAt} />
                    </span>
                    <button class="pp-link-btn" onClick={() => host.copy(webAppUrl(host.serverUrl, `/invite/${g.token}`)).then(() => toast('Copied', 'success'))}>
                      Copy
                    </button>
                    <button class="pp-link-btn" onClick={() => run(async () => (await host.api.revokeGuestGrant(workspaceId, g.id), reloadGrants()), 'Guest link revoked')}>
                      Revoke
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ---------------- notifications ----------------

export function NotificationSettings({ workspaceId, member }: { workspaceId: string; member: Member }) {
  const { host } = useUi();
  const [prefs, setPrefs] = useState<NotificationPrefs>(member.notificationPrefs ?? defaultNotificationPrefs());
  const { busy, run } = useSaver();
  useEffect(() => setPrefs(member.notificationPrefs ?? defaultNotificationPrefs()), [member.id]);
  const labels = { mention: 'Mentions', reply: 'Replies in threads I joined', assignment: 'Assignments', resolution: 'Resolutions of my threads' };
  return (
    <form
      class="pp-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => (await host.api.updateMyPreferences(workspaceId, prefs), host.refreshSession()));
      }}
    >
      <h2>Notify me about</h2>
      <table class="pp-table">
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col">In app</th>
            <th scope="col">Email</th>
            <th scope="col">Slack / Teams</th>
          </tr>
        </thead>
        <tbody>
          {NOTIFICATION_EVENTS.map((ev) => (
            <tr key={ev}>
              <th scope="row">{labels[ev]}</th>
              {(['inApp', 'email', 'chat'] as const).map((ch) => (
                <td key={ch}>
                  <input
                    type="checkbox"
                    aria-label={`${labels[ev]} via ${ch}`}
                    checked={prefs.events[ev][ch]}
                    onChange={(e) => setPrefs({ ...prefs, events: { ...prefs.events, [ev]: { ...prefs.events[ev], [ch]: (e.target as HTMLInputElement).checked } } })}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Field label="Email delivery">
        <select value={prefs.emailMode} onChange={(e) => setPrefs({ ...prefs, emailMode: (e.target as HTMLSelectElement).value as NotificationPrefs['emailMode'] })}>
          <option value="immediate">Immediately</option>
          <option value="digest">Daily digest</option>
        </select>
      </Field>
      <div class="pp-row pp-end">
        <button class="pp-btn pp-btn-primary" disabled={busy}>
          Save preferences
        </button>
      </div>
    </form>
  );
}

// ---------------- integrations ----------------

const INTEGRATION_FIELDS: Record<IntegrationKind, { title: string; fields: { key: string; label: string; secret?: boolean; placeholder?: string }[] }> = {
  slack: { title: 'Slack', fields: [{ key: 'webhookUrl', label: 'Incoming webhook URL', secret: true, placeholder: 'https://hooks.slack.com/services/…' }] },
  teams: { title: 'Microsoft Teams', fields: [{ key: 'webhookUrl', label: 'Incoming webhook URL', secret: true }] },
  linear: {
    title: 'Linear',
    fields: [
      { key: 'apiKey', label: 'API key', secret: true },
      { key: 'teamId', label: 'Team ID' },
    ],
  },
  jira: {
    title: 'Jira',
    fields: [
      { key: 'baseUrl', label: 'Site URL', placeholder: 'https://acme.atlassian.net' },
      { key: 'email', label: 'Account email' },
      { key: 'apiToken', label: 'API token', secret: true },
      { key: 'projectKey', label: 'Project key' },
      { key: 'issueType', label: 'Issue type', placeholder: 'Task' },
    ],
  },
  github: {
    title: 'GitHub Issues',
    fields: [
      { key: 'token', label: 'Token', secret: true },
      { key: 'owner', label: 'Owner' },
      { key: 'repo', label: 'Repository' },
    ],
  },
};

export function IntegrationSettings({ workspaceId }: { workspaceId: string }) {
  const { host } = useUi();
  const { data, error, loading, reload } = useAsync(() => host.api.listIntegrations(workspaceId), [workspaceId]);
  if (loading && !data) return <Skeleton rows={5} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div class="pp-form">
      {(Object.keys(INTEGRATION_FIELDS) as IntegrationKind[]).map((k) => (
        <IntegrationCard key={k} workspaceId={workspaceId} kind={k} config={data?.find((c) => c.kind === k)} />
      ))}
    </div>
  );
}

function IntegrationCard({ workspaceId, kind, config }: { workspaceId: string; kind: IntegrationKind; config?: IntegrationConfig }) {
  const { host } = useUi();
  const spec = INTEGRATION_FIELDS[kind];
  const [enabled, setEnabled] = useState(config?.enabled ?? false);
  const [settings, setSettings] = useState<Record<string, string>>(config?.settings ?? {});
  const { busy, run } = useSaver();
  return (
    <form
      class="pp-card"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => host.api.saveIntegration(workspaceId, kind, { enabled, settings }));
      }}
    >
      <div class="pp-row">
        <h3 class="pp-grow">{spec.title}</h3>
        <Toggle checked={enabled} onChange={setEnabled} label="Enabled" />
      </div>
      {spec.fields.map((f) => (
        <Field key={f.key} label={f.label}>
          <input
            type={f.secret ? 'password' : 'text'}
            autoComplete="off"
            placeholder={f.placeholder}
            value={settings[f.key] ?? ''}
            onInput={(e) => setSettings({ ...settings, [f.key]: (e.target as HTMLInputElement).value })}
          />
        </Field>
      ))}
      <div class="pp-row pp-end">
        <button class="pp-btn pp-btn-primary pp-btn-sm" disabled={busy}>
          Save
        </button>
      </div>
    </form>
  );
}

// ---------------- developer ----------------

const WEBHOOK_EVENTS: WebhookEvent[] = ['thread.created', 'thread.updated', 'thread.deleted', 'comment.created', 'comment.updated', 'comment.deleted'];

export function DeveloperSettings({ workspaceId }: { workspaceId: string }) {
  const { host, toast, confirm } = useUi();
  const { data: keys = [], reload: reloadKeys } = useAsync(() => host.api.listApiKeys(workspaceId), [workspaceId]);
  const { data: hooks = [], reload: reloadHooks } = useAsync(() => host.api.listWebhooks(workspaceId), [workspaceId]);
  const [keyName, setKeyName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [hookUrl, setHookUrl] = useState('');
  const [hookEvents, setHookEvents] = useState<WebhookEvent[]>(['thread.created', 'comment.created']);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const { busy, run } = useSaver();

  return (
    <div class="pp-form">
      <h2>API keys</h2>
      <p class="pp-muted pp-small">
        Use <code>Authorization: Bearer pk_…</code> with the REST API at <code>{host.serverUrl}/api/v1</code>.
      </p>
      <form
        class="pp-row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!keyName.trim()) return;
          await run(async () => {
            const k = await host.api.createApiKey(workspaceId, keyName.trim());
            setNewKey(k.key ?? null);
            setKeyName('');
            reloadKeys();
          }, 'API key created');
        }}
      >
        <input class="pp-grow" aria-label="Key name" placeholder="CI export" value={keyName} onInput={(e) => setKeyName((e.target as HTMLInputElement).value)} />
        <button class="pp-btn" disabled={busy}>
          Create key
        </button>
      </form>
      {newKey && (
        <div class="pp-notice">
          Copy this key now — it will not be shown again: <code class="pp-select-all">{newKey}</code>
          <button class="pp-btn pp-btn-sm" onClick={() => host.copy(newKey).then(() => toast('Copied', 'success'))}>
            Copy
          </button>
        </div>
      )}
      <ul class="pp-simple-list">
        {keys.map((k) => (
          <li key={k.id}>
            <span class="pp-grow">
              <strong>{k.name}</strong> <code>{k.prefix}…</code> · created <RelTime iso={k.createdAt} />
              {k.lastUsedAt && (
                <>
                  {' '}
                  · last used <RelTime iso={k.lastUsedAt} />
                </>
              )}
            </span>
            <button
              class="pp-link-btn pp-danger"
              onClick={async () => {
                if (await confirm({ title: `Delete key "${k.name}"?`, confirmLabel: 'Delete', danger: true })) run(async () => (await host.api.deleteApiKey(workspaceId, k.id), reloadKeys()), 'Key deleted');
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <h2>Webhooks</h2>
      <p class="pp-muted pp-small">Deliveries are signed with HMAC-SHA256 in the X-Pinpoint-Signature header.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await run(async () => {
            const h = await host.api.createWebhook(workspaceId, { url: hookUrl, events: hookEvents });
            setNewSecret(h.secret ?? null);
            setHookUrl('');
            reloadHooks();
          }, 'Webhook created');
        }}
      >
        <Field label="Endpoint URL">
          <input type="url" required placeholder="https://example.com/hooks/pinpoint" value={hookUrl} onInput={(e) => setHookUrl((e.target as HTMLInputElement).value)} />
        </Field>
        <fieldset class="pp-fieldset pp-row pp-wrap">
          <legend>Events</legend>
          {WEBHOOK_EVENTS.map((ev) => (
            <Toggle key={ev} label={ev} checked={hookEvents.includes(ev)} onChange={(on) => setHookEvents(on ? [...hookEvents, ev] : hookEvents.filter((x) => x !== ev))} />
          ))}
        </fieldset>
        <div class="pp-row pp-end">
          <button class="pp-btn" disabled={busy || !hookEvents.length}>
            Add webhook
          </button>
        </div>
      </form>
      {newSecret && (
        <div class="pp-notice">
          Signing secret (shown once): <code class="pp-select-all">{newSecret}</code>
        </div>
      )}
      <ul class="pp-simple-list">
        {hooks.map((h) => (
          <li key={h.id}>
            <span class="pp-grow">
              <code>{h.url}</code> · {h.events.join(', ')} {h.active ? '' : '(inactive)'}
            </span>
            <button class="pp-link-btn pp-danger" onClick={() => run(async () => (await host.api.deleteWebhook(workspaceId, h.id), reloadHooks()), 'Webhook deleted')}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------- account ----------------

export function AccountSettings() {
  const { host, session, confirm, setSession } = useUi();
  const me = session.me;
  const [name, setName] = useState(me?.user.name ?? '');
  const { busy, run } = useSaver();
  if (!me) return null;
  return (
    <div class="pp-form">
      <h2>Profile</h2>
      <form
        class="pp-row"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await host.api.updateMe({ name });
            setSession(await host.refreshSession());
          });
        }}
      >
        <Avatar user={me.user} size={36} />
        <input class="pp-grow" aria-label="Display name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <button class="pp-btn" disabled={busy}>
          Save
        </button>
      </form>
      <p class="pp-muted pp-small">Signed in as {me.user.email}</p>

      <h2>Privacy</h2>
      <Toggle
        checked={!me.analyticsOptOut}
        label="Share anonymous usage analytics (never page content or comment text)"
        onChange={(on) =>
          run(async () => {
            await host.api.updateMe({ analyticsOptOut: !on });
            setSession(await host.refreshSession());
          })
        }
      />

      <h2>Your data</h2>
      <div class="pp-row pp-wrap">
        <button
          class="pp-btn"
          onClick={() =>
            run(async () => {
              const data = await host.api.exportMyData();
              downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'pinpoint-my-data.json');
            }, 'Export downloaded')
          }
        >
          Download my data
        </button>
        <button class="pp-btn" onClick={() => host.signOut()}>
          Sign out
        </button>
        <button
          class="pp-btn pp-btn-danger"
          onClick={async () => {
            if (!(await confirm({ title: 'Delete your account?', body: 'Your profile and memberships are deleted. Comments you wrote are anonymized.', confirmLabel: 'Delete account', danger: true }))) return;
            await run(async () => {
              await host.api.deleteMe();
              await host.signOut();
            }, 'Account deleted');
          }}
        >
          Delete account
        </button>
      </div>
    </div>
  );
}
