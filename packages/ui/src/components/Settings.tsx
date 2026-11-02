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
import { Avatar, capitalize, downloadBlob, Empty, ErrorBox, Field, Icon, RelTime, Select, Skeleton, Toggle } from './common';
import { InvitePanel } from './Invite';

export type SettingsTab = 'workspace' | 'sites' | 'members' | 'notifications' | 'integrations' | 'developer' | 'account';

const TABS: { id: SettingsTab; label: string; admin?: boolean }[] = [
  { id: 'workspace', label: 'General' },
  { id: 'sites', label: 'Sites' },
  { id: 'members', label: 'People' },
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
  const current = tabs.some((t) => t.id === tab) ? tab : 'workspace';
  return (
    <div class="pp-settings">
      <div class="pp-settings-side">
        <h1 class="pp-h1">Settings</h1>
        <nav class="pp-tabs" role="tablist" aria-label="Settings sections" aria-orientation="vertical">
          {tabs.map((t) => (
            <button key={t.id} role="tab" id={`pp-tab-${t.id}`} aria-selected={current === t.id} class={current === t.id ? 'pp-active' : ''} onClick={() => onTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      <div class="pp-settings-body" role="tabpanel" aria-labelledby={`pp-tab-${current}`}>
        {current === 'workspace' && <WorkspaceSettings workspaceId={membership.workspace.id} role={role} only="general" />}
        {current === 'sites' && <WorkspaceSettings workspaceId={membership.workspace.id} role={role} only="sites" />}
        {current === 'members' && <MembersSettings workspaceId={membership.workspace.id} role={role} />}
        {current === 'notifications' && <NotificationSettings workspaceId={membership.workspace.id} member={membership.member} />}
        {current === 'integrations' && isAdmin && <IntegrationSettings workspaceId={membership.workspace.id} />}
        {current === 'developer' && isAdmin && <DeveloperSettings workspaceId={membership.workspace.id} />}
        {current === 'account' && <AccountSettings />}
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

export function WorkspaceSettings({ workspaceId, role, only = 'general' }: { workspaceId: string; role: Role; only?: 'general' | 'sites' }) {
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

  const dirty = JSON.stringify(draft) !== JSON.stringify(ws);
  const saveBar = (canSites || canShare) && (
    <div class={`pp-savebar ${dirty ? 'pp-dirty' : ''}`}>
      <span class="pp-muted pp-small pp-grow">{dirty ? 'You have unsaved changes' : 'All changes saved'}</span>
      {dirty && (
        <button type="button" class="pp-btn pp-btn-sm pp-btn-ghost" onClick={() => setDraft(ws ?? null)}>
          Discard
        </button>
      )}
      <button type="submit" class="pp-btn pp-btn-primary pp-btn-sm" disabled={busy || !dirty}>
        Save changes
      </button>
    </div>
  );

  if (only === 'sites')
    return (
      <form
        class="pp-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <section class="pp-section">
          <h2>Allowed sites</h2>
          <p class="pp-muted pp-small">
            Pinpoint only shows comments and the comment tool on these sites. <code>localhost</code> always works. Use <code>*.example.com</code> to include every subdomain.
          </p>
          {canSites && (
            <div class="pp-row">
              <input
                class="pp-grow"
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
              <button type="button" class="pp-btn" onClick={addSite} disabled={!newSite.trim()}>
                <Icon name="plus" size={14} /> Add site
              </button>
            </div>
          )}
          <ul class="pp-site-list" role="list">
            {draft.allowedSites.map((st) => (
              <li key={st}>
                <Icon name="globe" size={15} />
                <span class="pp-grow">{st}</span>
                {canSites && (
                  <button type="button" class="pp-icon-btn pp-icon-sm" aria-label={`Remove ${st}`} onClick={() => setDraft({ ...draft, allowedSites: draft.allowedSites.filter((x) => x !== st) })}>
                    <Icon name="x" size={14} />
                  </button>
                )}
              </li>
            ))}
            {!draft.allowedSites.length && <li class="pp-muted pp-small pp-site-empty">No sites yet — only localhost is enabled.</li>}
          </ul>
        </section>
        {saveBar}
      </form>
    );

  return (
    <form
      class="pp-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <section class="pp-section">
        <h2>Workspace</h2>
        <Field label="Name">
          <input value={draft.name} disabled={!canSites} onInput={(e) => setDraft({ ...draft, name: (e.target as HTMLInputElement).value })} />
        </Field>
      </section>

      <section class="pp-section">
        <h2>Sharing &amp; access</h2>
        <div class="pp-setting-row">
          <div class="pp-grow">
            <div class="pp-setting-title">Who can open shared links</div>
            <div class="pp-muted pp-small">Applies to every “Copy link” in this workspace.</div>
          </div>
          <Select<Workspace['linkSharing']>
            label="Who can open shared links"
            size="sm"
            align="end"
            disabled={!canShare}
            value={draft.linkSharing}
            onChange={(v) => setDraft({ ...draft, linkSharing: v })}
            options={[
              { value: 'members', label: 'Workspace members', hint: 'Sign-in required' },
              { value: 'anyone', label: 'Anyone with the link', hint: 'Public' },
            ]}
          />
        </div>
        <Field label="Only allow people with this email domain to join" hint="For example example.com. Leave empty to allow anyone you invite.">
          <input disabled={!canShare} placeholder="example.com" value={draft.emailDomain ?? ''} onInput={(e) => setDraft({ ...draft, emailDomain: (e.target as HTMLInputElement).value.trim() || null })} />
        </Field>
      </section>

      <section class="pp-section">
        <h2>Privacy</h2>
        <Toggle checked={draft.privacy.allowFullPage} disabled={!canShare} label="Allow full-page snapshots" hint="Scroll-and-stitch captures of the whole page." onChange={(v) => setDraft({ ...draft, privacy: { ...draft.privacy, allowFullPage: v } })} />
        <Toggle checked={draft.privacy.allowDom} disabled={!canShare} label="Allow HTML snapshots" hint="Saves the selected element’s HTML and styles for developers." onChange={(v) => setDraft({ ...draft, privacy: { ...draft.privacy, allowDom: v } })} />
        <Toggle checked={draft.privacy.requireBlurReview} disabled={!canShare} label="Ask to blur sensitive parts before saving" hint="Shows the blur tool every time a snapshot is taken." onChange={(v) => setDraft({ ...draft, privacy: { ...draft.privacy, requireBlurReview: v } })} />
        <Field label="Delete snapshots after (days)" hint="Leave empty to keep snapshots forever.">
          <input
            type="number"
            min={1}
            disabled={!canShare}
            placeholder="Keep forever"
            value={draft.privacy.snapshotRetentionDays ?? ''}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              setDraft({ ...draft, privacy: { ...draft.privacy, snapshotRetentionDays: v ? Math.max(1, Number(v)) : null } });
            }}
          />
        </Field>
      </section>

      {saveBar}

      {can(role, 'deleteWorkspace') && (
        <section class="pp-section pp-danger-zone">
          <h2>Delete workspace</h2>
          <p class="pp-muted pp-small">Deletes every thread, comment and snapshot for everyone. This cannot be undone.</p>
          <div>
            <button
              type="button"
              class="pp-btn pp-danger"
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
        </section>
      )}
    </form>
  );
}

// ---------------- members ----------------

export function MembersSettings({ workspaceId, role }: { workspaceId: string; role: Role }) {
  const { host, confirm, toast, session, membersCache } = useUi();
  const isAdmin = can(role, 'manageMembers');
  const { data: members, error, loading, reload } = useAsync(() => host.api.listMembers(workspaceId), [workspaceId]);
  const { data: grants = [], reload: reloadGrants } = useAsync(() => (isAdmin ? host.api.listGuestGrants(workspaceId) : Promise.resolve([])), [workspaceId, isAdmin]);
  const [guestThreads, setGuestThreads] = useState('');
  const { busy, run } = useSaver();
  const meId = session.me?.user.id;

  useEffect(() => {
    if (members) membersCache.set(workspaceId, members);
  }, [members]);

  if (loading && !members) return <Skeleton rows={6} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const changeRole = (m: Member, next: Role) => run(async () => (await host.api.updateMember(workspaceId, m.id, { role: next }), reload()), 'Role updated');
  const remove = async (m: Member) => {
    const self = m.userId === meId;
    if (!(await confirm({ title: self ? 'Leave this workspace?' : `Remove ${m.user.name || m.user.email}?`, body: self ? undefined : 'They lose access right away. Their comments stay.', confirmLabel: self ? 'Leave' : 'Remove', danger: true }))) return;
    await run(async () => {
      await host.api.removeMember(workspaceId, m.id);
      if (self) await host.refreshSession();
      else reload();
    }, self ? 'You left the workspace' : 'Member removed');
  };
  const ROLE_HINT: Record<Role, string> = { owner: 'Full control', admin: 'Manage people & sites', member: 'Comment and resolve', guest: 'Shared items only' };

  return (
    <div class="pp-form">
      {isAdmin && (
        <section class="pp-section">
          <h2>Invite people</h2>
          <InvitePanel workspaceId={workspaceId} />
        </section>
      )}

      <section class="pp-section">
        <h2>Members · {members?.length ?? 0}</h2>
        <ul class="pp-member-list" role="list">
          {(members ?? []).map((m) => (
            <li key={m.id} class="pp-member">
              <Avatar user={m.user} size={32} />
              <span class="pp-row-body">
                <strong>
                  {m.user.name || m.user.email}
                  {m.userId === meId ? <span class="pp-muted"> (you)</span> : null}
                </strong>
                <span class="pp-muted pp-small">{m.user.email}</span>
              </span>
              {isAdmin && m.userId !== meId ? (
                <Select<Role>
                  label={`Role for ${m.user.name || m.user.email}`}
                  size="sm"
                  align="end"
                  value={m.role}
                  disabled={busy}
                  onChange={(r) => changeRole(m, r)}
                  options={(['owner', 'admin', 'member', 'guest'] as Role[]).map((r) => ({ value: r, label: capitalize(r), hint: ROLE_HINT[r], disabled: !canChangeRole(role, m.role, r) }))}
                />
              ) : (
                <span class="pp-badge">{capitalize(m.role)}</span>
              )}
              {(m.userId === meId ? m.role !== 'owner' : isAdmin && canChangeRole(role, m.role, m.role)) && (
                <button class="pp-btn pp-btn-sm pp-btn-ghost" onClick={() => remove(m)}>
                  {m.userId === meId ? 'Leave' : 'Remove'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && (
        <section class="pp-section">
          <h2>Guest links</h2>
          <p class="pp-muted pp-small">Give clients or stakeholders access to specific threads or pages only. Tip: “Copy link” on a thread is often enough when link sharing is set to “Anyone with the link”.</p>
          <form
            class="pp-row pp-wrap"
            onSubmit={async (e) => {
              e.preventDefault();
              const ids = guestThreads
                .split(/[\s,]+/)
                .map((x) => x.replace(/^.*[?&]thread=/, '').replace(/^.*\/thread\//, ''))
                .filter(Boolean);
              const threadIds = ids.filter((x) => !x.startsWith('page:'));
              const pageIds = ids.filter((x) => x.startsWith('page:')).map((x) => x.slice(5));
              if (!ids.length) return toast('Paste thread links or IDs (or page:<id>)', 'error');
              await run(async () => {
                const g = await host.api.createGuestGrant(workspaceId, { threadIds, pageIds });
                await host.copy(g.url);
                setGuestThreads('');
                reloadGrants();
              }, 'Guest link created and copied');
            }}
          >
            <input class="pp-grow" aria-label="Thread links or IDs" placeholder="Paste thread links or IDs, comma separated" value={guestThreads} onInput={(e) => setGuestThreads((e.target as HTMLInputElement).value)} />
            <button class="pp-btn">Create guest link</button>
          </form>
          {grants.filter((g) => !g.revokedAt).length > 0 && (
            <ul class="pp-simple-list">
              {grants
                .filter((g) => !g.revokedAt)
                .map((g) => (
                  <li key={g.id}>
                    <Icon name="link" size={14} />
                    <span class="pp-grow">
                      {g.threadIds.length} thread{g.threadIds.length === 1 ? '' : 's'}, {g.pageIds.length} page{g.pageIds.length === 1 ? '' : 's'} · <RelTime iso={g.createdAt} />
                    </span>
                    <button class="pp-link-btn pp-small" onClick={() => host.copy(webAppUrl(host.serverUrl, `/invite/${g.token}`)).then(() => toast('Guest link copied', 'success'))}>
                      Copy
                    </button>
                    <button class="pp-link-btn pp-small pp-danger" onClick={() => run(async () => (await host.api.revokeGuestGrant(workspaceId, g.id), reloadGrants()), 'Guest link turned off')}>
                      Turn off
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </section>
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
        <Select<NotificationPrefs['emailMode']>
          label="Email delivery"
          value={prefs.emailMode}
          onChange={(v) => setPrefs({ ...prefs, emailMode: v })}
          options={[
            { value: 'immediate', label: 'Right away' },
            { value: 'digest', label: 'Once a day (digest)' },
          ]}
        />
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
