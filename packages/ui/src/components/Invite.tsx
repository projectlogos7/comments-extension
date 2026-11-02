import { useEffect, useRef, useState } from 'preact/hooks';
import { can, type Invite, type Role } from '@pinpoint/shared';
import { errorMessage, useActiveMembership, useAsync, useUi } from '../context';
import { webAppUrl } from '../host';
import { Icon, Modal, RelTime, Select } from './common';

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

export function parseEmails(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim().replace(/^<|>$/g, '').toLowerCase())
    .filter(Boolean);
}

export function isEmail(s: string) {
  return EMAIL_RE.test(s);
}

/** Email field that turns each address into a chip (comma, space, Enter, Tab or paste). */
export function EmailChips({ value, onChange, placeholder = 'name@company.com, …', domain, autoFocus }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; domain?: string | null; autoFocus?: boolean }) {
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, []);
  const commit = (text: string) => {
    const add = parseEmails(text).filter((e) => !value.includes(e));
    if (add.length) onChange([...value, ...add]);
    setDraft('');
  };
  const problem = (e: string) => (!isEmail(e) ? 'Not a valid email address' : domain && !e.endsWith('@' + domain) ? `Only @${domain} addresses can join` : null);
  return (
    <div class="pp-chips-input" onClick={() => input.current?.focus()}>
      {value.map((e) => {
        const p = problem(e);
        return (
          <span key={e} class={`pp-chip ${p ? 'pp-chip-bad' : ''}`} title={p ?? e}>
            {e}
            <button type="button" aria-label={`Remove ${e}`} onClick={() => onChange(value.filter((x) => x !== e))}>
              <Icon name="x" size={11} />
            </button>
          </span>
        );
      })}
      <input
        ref={input}
        type="email"
        multiple
        value={draft}
        aria-label="Email addresses to invite"
        placeholder={value.length ? '' : placeholder}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          if (/[\s,;]/.test(v)) commit(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === 'Tab') && draft.trim()) {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onPaste={(e) => {
          const t = e.clipboardData?.getData('text') ?? '';
          if (/[\s,;]/.test(t)) {
            e.preventDefault();
            commit(draft + t);
          }
        }}
        onBlur={() => draft.trim() && commit(draft)}
      />
    </div>
  );
}

/** Invite form + invite link + pending invites. Used by the Invite dialog, onboarding and Settings. */
export function InvitePanel({ workspaceId, compact, autoFocus, onSent }: { workspaceId: string; compact?: boolean; autoFocus?: boolean; onSent?: (invites: Invite[]) => void }) {
  const { host, toast, confirm } = useUi();
  const membership = useActiveMembership();
  const myRole = membership?.workspace.id === workspaceId ? membership.member.role : null;
  const { data: ws, setData: setWs } = useAsync(() => host.api.getWorkspace(workspaceId), [workspaceId]);
  const { data: invites = [], reload: reloadInvites, setData: setInvites } = useAsync(() => host.api.listInvites(workspaceId), [workspaceId]);
  const [emails, setEmails] = useState<string[]>([]);
  const [role, setRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string[]>([]);
  const [manage, setManage] = useState(false);
  const domain = ws?.emailDomain ?? null;
  const inviteUrl = ws?.inviteToken ? webAppUrl(host.serverUrl, `/invite/${ws.inviteToken}`) : null;
  const pending = invites.filter((i) => !i.acceptedAt);
  const bad = emails.filter((e) => !isEmail(e) || (domain && role !== 'guest' && !e.endsWith('@' + domain)));

  const send = async (e?: Event) => {
    e?.preventDefault();
    if (!emails.length) return toast('Add at least one email address', 'error');
    if (bad.length) return toast(`Fix ${bad.length === 1 ? 'this address' : 'these addresses'} first: ${bad.join(', ')}`, 'error');
    setBusy(true);
    try {
      const out = await host.api.invite(workspaceId, emails, role);
      const skipped = emails.length - out.length;
      setSentTo(out.map((i) => i.email));
      setEmails([]);
      reloadInvites();
      onSent?.(out);
      toast(
        out.length
          ? `Invitation${out.length === 1 ? '' : 's'} sent to ${out.length === 1 ? out[0].email : `${out.length} people`}${skipped ? ` (${skipped} already a member)` : ''}`
          : 'Everyone you entered is already a member',
        'success',
      );
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      let url = inviteUrl;
      if (!url) {
        const r = await host.api.rotateInviteLink(workspaceId);
        if (ws) setWs({ ...ws, inviteToken: r.token });
        url = webAppUrl(host.serverUrl, `/invite/${r.token}`);
      }
      await host.copy(url);
      toast('Invite link copied', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const resetLink = async () => {
    if (!(await confirm({ title: 'Reset the invite link?', body: 'The current link stops working. People who already joined keep their access.', confirmLabel: 'Reset link' }))) return;
    try {
      const r = await host.api.rotateInviteLink(workspaceId);
      if (ws) setWs({ ...ws, inviteToken: r.token });
      await host.copy(webAppUrl(host.serverUrl, `/invite/${r.token}`));
      toast('New invite link copied', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const disableLink = async () => {
    if (!(await confirm({ title: 'Turn off the invite link?', body: 'Nobody new can join with a link until you create one again.', confirmLabel: 'Turn off', danger: true }))) return;
    try {
      await host.api.disableInviteLink(workspaceId);
      if (ws) setWs({ ...ws, inviteToken: null });
      setManage(false);
      toast('Invite link turned off', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const resend = async (i: Invite) => {
    try {
      await host.api.resendInvite(workspaceId, i.id);
      toast(`Invitation re-sent to ${i.email}`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const revoke = async (i: Invite) => {
    try {
      await host.api.revokeInvite(workspaceId, i.id);
      setInvites(invites.filter((x) => x.id !== i.id));
      toast('Invitation cancelled', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const roles: { value: Role; label: string; hint: string }[] = [
    { value: 'member', label: 'Member', hint: 'Comment, reply, resolve' },
    { value: 'admin', label: 'Admin', hint: 'Also manage people & sites' },
    ...(myRole === 'owner' ? [{ value: 'owner' as Role, label: 'Owner', hint: 'Full control' }] : []),
  ];

  return (
    <div class={`pp-invite ${compact ? 'pp-invite-compact' : ''}`}>
      <form class="pp-invite-form" onSubmit={send}>
        <EmailChips value={emails} onChange={(v) => (setEmails(v), setSentTo([]))} domain={role === 'guest' ? null : domain} autoFocus={autoFocus} />
        <div class="pp-row">
          <Select<Role> label="Role for new people" value={role} onChange={setRole} options={roles} size="md" />
          <span class="pp-grow" />
          <button class="pp-btn pp-btn-primary" disabled={busy || !emails.length}>
            <Icon name="send" size={15} />
            {busy ? 'Sending…' : emails.length > 1 ? `Send ${emails.length} invites` : 'Send invite'}
          </button>
        </div>
        {domain && <p class="pp-muted pp-small">Only people with an @{domain} email can join this workspace.</p>}
        {sentTo.length > 0 && (
          <p class="pp-success-line" role="status">
            <Icon name="check" size={14} /> Sent to {sentTo.join(', ')}. They’ll get an email with a link to join.
          </p>
        )}
      </form>

      <div class="pp-invite-link">
        <span class="pp-share-link-icon" aria-hidden="true">
          <Icon name="link" />
        </span>
        <div class="pp-grow">
          <div class="pp-share-access-title">Or share an invite link</div>
          <div class="pp-muted pp-small">{inviteUrl ? 'Anyone with this link can join as a member.' : 'The invite link is turned off.'}</div>
        </div>
        <button type="button" class="pp-btn" onClick={copyLink}>
          <Icon name="copy" size={15} /> {inviteUrl ? 'Copy link' : 'Create link'}
        </button>
        {inviteUrl && (
          <button type="button" class="pp-link-btn pp-small" aria-expanded={manage} onClick={() => setManage(!manage)}>
            Manage
          </button>
        )}
      </div>
      {manage && inviteUrl && (
        <div class="pp-invite-manage">
          <input readOnly value={inviteUrl} aria-label="Invite link" class="pp-grow" onFocus={(e) => (e.target as HTMLInputElement).select()} />
          <button type="button" class="pp-btn pp-btn-sm" onClick={resetLink}>
            <Icon name="refresh" size={14} /> Reset
          </button>
          <button type="button" class="pp-btn pp-btn-sm pp-danger" onClick={disableLink}>
            Turn off
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <div class="pp-pending">
          <h3 class="pp-section-label">Waiting to join · {pending.length}</h3>
          <ul class="pp-pending-list" role="list">
            {pending.map((i) => (
              <li key={i.id}>
                <span class="pp-pending-icon" aria-hidden="true">
                  <Icon name="mail" size={14} />
                </span>
                <span class="pp-grow pp-clip">
                  {i.email}
                  <span class="pp-muted pp-small">
                    {' '}
                    · {i.role} · invited <RelTime iso={i.createdAt} />
                  </span>
                </span>
                <button type="button" class="pp-link-btn pp-small" onClick={() => resend(i)}>
                  Resend
                </button>
                <button type="button" class="pp-link-btn pp-small pp-danger" onClick={() => revoke(i)} aria-label={`Cancel invitation for ${i.email}`}>
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function InviteDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const membership = useActiveMembership();
  return (
    <Modal title={`Invite people to ${membership?.workspace.name ?? 'your workspace'}`} description="They can comment on your sites and see everyone’s feedback." onClose={onClose} size="md">
      <InvitePanel workspaceId={workspaceId} autoFocus />
    </Modal>
  );
}

/** Header button: visible to people who can invite (owners and admins). */
export function InviteButton({ class: cls = 'pp-btn pp-btn-sm' }: { class?: string }) {
  const membership = useActiveMembership();
  const [open, setOpen] = useState(false);
  if (!membership || !can(membership.member.role, 'manageMembers')) return null;
  return (
    <>
      <button type="button" class={cls} onClick={() => setOpen(true)}>
        <Icon name="userPlus" size={15} /> Invite
      </button>
      {open && <InviteDialog workspaceId={membership.workspace.id} onClose={() => setOpen(false)} />}
    </>
  );
}
