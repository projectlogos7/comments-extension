import { useEffect, useState } from 'preact/hooks';
import { can, type LinkSharing, type Page, type Thread } from '@pinpoint/shared';
import { errorMessage, useActiveMembership, useUi } from '../context';
import { shareUrlFor } from '../host';
import { Icon, Modal, Select } from './common';

/** Create (if needed) and copy a thread's share link in one step. Returns the token. */
export async function copyThreadLink(host: ReturnType<typeof useUi>['host'], thread: Pick<Thread, 'id' | 'shareToken'>): Promise<string> {
  const info = thread.shareToken ? { token: thread.shareToken, url: shareUrlFor(host.serverUrl, thread.shareToken)! } : await host.api.shareThread(thread.id);
  await host.copy(info.url || shareUrlFor(host.serverUrl, info.token)!);
  return info.token;
}

export interface ShareDialogProps {
  thread?: Thread;
  /** Page to share when no thread is given (page link). */
  page?: Pick<Page, 'id' | 'title' | 'normalizedUrl'>;
  onClose: () => void;
  /** Called when the thread's link is created or revoked. */
  onTokenChange?: (token: string | null) => void;
  /** Link was already created and copied by the caller. */
  justCopied?: boolean;
}

/**
 * Share dialog: one link, who can open it, copy, turn off. Admins can switch the workspace's link
 * setting here; everyone else sees it read-only.
 */
export function ShareDialog({ thread, page, onClose, onTokenChange, justCopied }: ShareDialogProps) {
  const { host, toast, confirm } = useUi();
  const membership = useActiveMembership();
  const role = membership?.member.role ?? null;
  const ws = membership?.workspace;
  const isAdmin = can(role, 'manageSharing');
  const [token, setToken] = useState<string | null>(thread?.shareToken ?? null);
  const [linkSharing, setLinkSharing] = useState<LinkSharing>(ws?.linkSharing ?? 'members');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(!!justCopied);
  const target = thread ? 'comment' : 'page';
  const url = token ? shareUrlFor(host.serverUrl, token) : null;

  useEffect(() => setLinkSharing(ws?.linkSharing ?? 'members'), [ws?.linkSharing]);

  // Page links are created when the dialog opens (they are cheap and idempotent).
  useEffect(() => {
    if (thread || !page) return;
    host.api
      .sharePage(page.id)
      .then((i) => setToken(i.token))
      .catch((e) => toast(errorMessage(e), 'error'));
  }, [page?.id]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = () =>
    run(async () => {
      let t = token;
      if (!t && thread) {
        t = (await host.api.shareThread(thread.id)).token;
        setToken(t);
        onTokenChange?.(t);
      }
      if (!t) return;
      await host.copy(shareUrlFor(host.serverUrl, t)!);
      setCopied(true);
      toast('Link copied', 'success');
    });

  const revoke = () =>
    run(async () => {
      const ok = await confirm({
        title: 'Turn off this link?',
        body: 'Anyone who has the current link will no longer be able to open it. You can create a new link later.',
        confirmLabel: 'Turn off link',
        danger: true,
      });
      if (!ok) return;
      if (thread) await host.api.revokeThreadShare(thread.id);
      else if (page) await host.api.revokePageShare(page.id);
      setToken(null);
      setCopied(false);
      onTokenChange?.(null);
      toast('Link turned off', 'success');
    });

  const copyPageLink = () =>
    run(async () => {
      if (!thread) return;
      const info = await host.api.sharePage(thread.pageId);
      await host.copy(info.url || shareUrlFor(host.serverUrl, info.token)!);
      toast('Page link copied — it lists every comment on this page', 'success');
    });

  const changeAccess = (v: LinkSharing) =>
    run(async () => {
      if (!ws) return;
      await host.api.updateWorkspace(ws.id, { linkSharing: v });
      setLinkSharing(v);
      await host.refreshSession();
      toast(v === 'anyone' ? 'Anyone with a link can now open shared comments' : 'Links now require a workspace sign-in', 'success');
    });

  const title = thread ? `Share comment #${thread.number}` : `Share all comments on this page`;

  return (
    <Modal title={title} onClose={onClose} size="md" description={thread ? 'Send a link that opens this comment, its snapshot and the conversation.' : page?.title || page?.normalizedUrl}>
      <div class="pp-share">
        <div class="pp-share-link">
          <span class="pp-share-link-icon" aria-hidden="true">
            <Icon name="link" />
          </span>
          {url ? (
            <input class="pp-grow pp-share-url" readOnly value={url} aria-label="Share link" onFocus={(e) => (e.target as HTMLInputElement).select()} />
          ) : (
            <span class="pp-grow pp-muted">{thread ? 'No link yet — copying creates one.' : 'Creating link…'}</span>
          )}
          <button class="pp-btn pp-btn-primary" data-autofocus disabled={busy} onClick={copy}>
            <Icon name={copied ? 'check' : 'copy'} size={15} />
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <div class="pp-share-access">
          <span class="pp-share-access-icon" aria-hidden="true">
            <Icon name={linkSharing === 'anyone' ? 'globe' : 'lock'} />
          </span>
          <div class="pp-grow">
            <div class="pp-share-access-title">Who can open it</div>
            <div class="pp-muted pp-small">
              {linkSharing === 'anyone'
                ? 'Anyone with the link — no account needed. Good for clients and stakeholders.'
                : `Only members of ${ws?.name ?? 'the workspace'}, after signing in.`}
            </div>
          </div>
          {isAdmin ? (
            <Select<LinkSharing>
              label="Who can open shared links"
              value={linkSharing}
              size="sm"
              align="end"
              disabled={busy}
              onChange={changeAccess}
              options={[
                { value: 'members', label: 'Workspace members', hint: 'Sign-in required' },
                { value: 'anyone', label: 'Anyone with the link', hint: 'Public' },
              ]}
            />
          ) : (
            <span class="pp-badge">{linkSharing === 'anyone' ? 'Anyone with the link' : 'Workspace members'}</span>
          )}
        </div>
        {isAdmin && <p class="pp-muted pp-small pp-share-note">This setting applies to every shared link in {ws?.name ?? 'this workspace'}.</p>}

        <div class="pp-share-foot">
          {thread && (
            <button class="pp-btn pp-btn-ghost pp-btn-sm" disabled={busy} onClick={copyPageLink}>
              <Icon name="copy" size={14} /> Copy link to all comments on this page
            </button>
          )}
          <span class="pp-grow" />
          {token && (
            <button class="pp-btn pp-btn-ghost pp-btn-sm pp-danger" disabled={busy} onClick={revoke}>
              Turn off link
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
