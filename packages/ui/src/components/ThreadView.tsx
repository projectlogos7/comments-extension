import { useEffect, useState } from 'preact/hooks';
import {
  can,
  draftKey,
  PRIORITIES,
  renderBody,
  THREAD_TYPES,
  type ActivityEntry,
  type Comment,
  type CopyFormat,
  type IntegrationConfig,
  type Member,
  type Priority,
  type Snapshot,
  type ThreadDetail,
  type ThreadType,
  type TicketLink,
} from '@pinpoint/shared';
import { errorMessage, useAsync, useMembers, useRole, useUi, useUiEvents } from '../context';
import { shareUrlFor } from '../host';
import { Avatar, Badge, capitalize, Empty, ErrorBox, Menu, Modal, RelTime, Skeleton, StatusBadge, type MenuItem } from './common';
import { Composer } from './Composer';
import { availableCopyFormats, COPY_LABELS, copyText } from './copy';

export const REACTIONS = ['👍', '👀', '✅', '🎉', '❤️', '😕'];

export interface ThreadViewProps {
  threadId: string;
  onClose?: () => void;
  onDeleted?: () => void;
  /** Compact layout for the side panel. */
  compact?: boolean;
}

export function ThreadView({ threadId, onClose, onDeleted, compact }: ThreadViewProps) {
  const { host, toast, confirm, session } = useUi();
  const role = useRole();
  const meId = session.me?.user.id;
  const { data: thread, error, loading, reload, setData } = useAsync(() => host.api.getThread(threadId), [threadId]);
  const ws = thread?.workspaceId;
  const members = useMembers(ws);
  const [showActivity, setShowActivity] = useState(false);
  const [snapOpen, setSnapOpen] = useState<Snapshot | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([]);
  const [tickets, setTickets] = useState<TicketLink[]>([]);

  useUiEvents((e) => {
    if (e.kind === 'threads.changed' && (!e.threadId || e.threadId === threadId)) reload();
  }, [threadId]);

  useEffect(() => {
    if (!thread) return;
    if (thread.unread) host.api.markRead(threadId).catch(() => {});
    host.api.markNotificationsRead({ threadId }).catch(() => {});
  }, [thread?.id]);

  useEffect(() => {
    if (!ws) return;
    host.api.listIntegrations(ws).then(setIntegrations).catch(() => setIntegrations([]));
    host.api.listTickets(threadId).then(setTickets).catch(() => setTickets([]));
  }, [ws, threadId]);

  if (loading && !thread) return <Skeleton rows={6} />;
  if (error && !thread) return <ErrorBox error={error} onRetry={reload} />;
  if (!thread) return <Empty title="Thread not found" />;

  const isAuthor = thread.createdBy === meId;
  const canResolve = can(role, 'resolveAny') || (can(role, 'resolveOwn') && isAuthor);
  const canEditMeta = can(role, 'assign');

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const update = (input: Parameters<typeof host.api.updateThread>[1], ok?: string) =>
    run(async () => setData(await host.api.updateThread(thread.id, input)), ok);

  const ensureShare = async (): Promise<ThreadDetail> => {
    if (thread.shareToken || !can(role, 'createShareLink')) return thread;
    const info = await host.api.shareThread(thread.id);
    const next = { ...thread, shareToken: info.token };
    setData(next);
    return next;
  };

  const doCopy = (format: CopyFormat) =>
    run(async () => {
      const t = format === 'markdown' || format === 'ai' ? await ensureShare() : thread;
      const text = copyText(t, format, host.serverUrl);
      if (!text) throw new Error(`No ${COPY_LABELS[format]} available for this thread`);
      await host.copy(text);
    }, `${COPY_LABELS[format]} copied`);

  const copyLink = () =>
    run(async () => {
      const info = await host.api.shareThread(thread.id);
      setData({ ...thread, shareToken: info.token });
      await host.copy(info.url || shareUrlFor(host.serverUrl, info.token)!);
    }, 'Link copied');

  const copyPageLink = () =>
    run(async () => {
      const info = await host.api.sharePage(thread.pageId);
      await host.copy(info.url || `${host.serverUrl}/share/${info.token}`);
    }, 'Page link copied');

  const revokeLink = () =>
    run(async () => {
      if (!(await confirm({ title: 'Revoke share link?', body: 'Anyone using the current link will lose access.', confirmLabel: 'Revoke', danger: true }))) return;
      await host.api.revokeThreadShare(thread.id);
      setData({ ...thread, shareToken: null });
      toast('Link revoked', 'success');
    });

  const deleteThread = () =>
    run(async () => {
      if (!(await confirm({ title: 'Delete this thread?', body: 'The thread, its replies and snapshots will be deleted.', confirmLabel: 'Delete', danger: true }))) return;
      await host.api.deleteThread(thread.id);
      toast('Thread deleted', 'success');
      onDeleted?.();
    });

  const enabledTickets = integrations.filter((i) => i.enabled && (i.kind === 'linear' || i.kind === 'jira' || i.kind === 'github'));
  const enabledChats = integrations.filter((i) => i.enabled && (i.kind === 'slack' || i.kind === 'teams'));

  const menuItems: MenuItem[] = [
    ...availableCopyFormats(thread).map((f) => ({ label: `Copy as ${COPY_LABELS[f]}`, onSelect: () => doCopy(f) })),
    ...(can(role, 'createShareLink') ? [{ label: 'Copy link', onSelect: copyLink }, { label: 'Copy page link', onSelect: copyPageLink }] : []),
    ...(thread.shareToken && (isAuthor || can(role, 'manageSharing')) ? [{ label: 'Revoke link', onSelect: revokeLink, danger: true }] : []),
    { label: thread.detached ? 'View snapshot' : 'Open on live page', onSelect: () => (thread.detached ? setSnapOpen(thread.snapshots[0] ?? null) : host.openThread(thread, { newTab: true })) },
    ...enabledTickets.map((i) => ({
      label: `Create ${capitalize(i.kind === 'github' ? 'GitHub' : i.kind)} issue`,
      onSelect: () =>
        run(async () => {
          const t = await host.api.createTicket(thread.id, i.kind as 'linear' | 'jira' | 'github');
          setTickets((ts) => [...ts, t]);
          await host.copy(t.url).catch(() => {});
        }, 'Ticket created — link copied'),
    })),
    ...enabledChats.map((i) => ({
      label: `Post to ${i.kind === 'slack' ? 'Slack' : 'Teams'}`,
      onSelect: () => run(() => host.api.postToChat(thread.id, i.kind as 'slack' | 'teams'), 'Posted'),
    })),
    ...(isAuthor || can(role, 'deleteAny') ? [{ label: 'Delete thread', onSelect: deleteThread, danger: true }] : []),
  ];

  const comments = thread.comments;
  const replyCount = comments.filter((c) => !c.deletedAt).length - 1;
  const snapshots = thread.snapshots;

  return (
    <article class={`pp-thread ${compact ? 'pp-compact' : ''}`} aria-label={`Thread ${thread.number}`}>
      <header class="pp-thread-head">
        <div class="pp-row pp-wrap">
          {onClose && (
            <button class="pp-icon-btn" aria-label="Back" onClick={onClose}>
              ←
            </button>
          )}
          <span class="pp-pin-num" aria-hidden="true">
            {thread.number}
          </span>
          <StatusBadge status={thread.status} />
          <Badge tone="scope">{capitalize(thread.scope)}</Badge>
          {thread.detached && (
            <Badge tone="warn" title="The element could not be found on the page">
              Detached
            </Badge>
          )}
          <span class="pp-grow" />
          {host.focusOnPage && !thread.detached && thread.scope !== 'page' && (
            <button class="pp-icon-btn" title="Show on page" aria-label="Show on page" onClick={() => host.focusOnPage!(thread.id)}>
              ◎
            </button>
          )}
          {!compact && (
            <button
              class="pp-btn pp-btn-sm"
              title={thread.detached ? 'The element is detached; opens the snapshot' : 'Open the live page and highlight this comment'}
              onClick={() => (thread.detached ? setSnapOpen(snapshots[0] ?? null) : host.openThread(thread, { newTab: true }))}
            >
              {thread.detached ? 'View snapshot' : 'Open on page ↗'}
            </button>
          )}
          {canResolve && (
            <button
              class={`pp-btn pp-btn-sm ${thread.status === 'open' ? 'pp-btn-primary' : ''}`}
              onClick={() => update({ status: thread.status === 'open' ? 'resolved' : 'open' }, thread.status === 'open' ? 'Resolved' : 'Reopened')}
            >
              {thread.status === 'open' ? 'Resolve' : 'Reopen'}
            </button>
          )}
          <Menu label="Thread actions" icon="⋯" buttonClass="pp-icon-btn" items={menuItems} />
        </div>
        <a class="pp-page-link" href={thread.page.normalizedUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => {
          e.preventDefault();
          if (thread.detached) setSnapOpen(snapshots[0] ?? null);
          else host.openThread(thread, { newTab: true });
        }}>
          {thread.page.title || thread.page.normalizedUrl}
        </a>
        {thread.status === 'resolved' && thread.resolvedAt && (
          <div class="pp-muted pp-small">
            Resolved by {members.find((m) => m.userId === thread.resolvedBy)?.user.name ?? 'someone'} <RelTime iso={thread.resolvedAt} />
          </div>
        )}
        <div class="pp-meta-grid">
          <label>
            <span>Assignee</span>
            <select
              disabled={!canEditMeta}
              value={thread.assigneeId ?? ''}
              onChange={(e) => update({ assigneeId: (e.target as HTMLSelectElement).value || null }, 'Assignee updated')}
            >
              <option value="">Unassigned</option>
              {members
                .filter((m) => m.role !== 'guest')
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.user.name || m.user.email}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Type</span>
            <select disabled={!canEditMeta} value={thread.type ?? ''} onChange={(e) => update({ type: ((e.target as HTMLSelectElement).value || null) as ThreadType | null })}>
              <option value="">None</option>
              {THREAD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {capitalize(t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Priority</span>
            <select disabled={!canEditMeta} value={thread.priority ?? ''} onChange={(e) => update({ priority: ((e.target as HTMLSelectElement).value || null) as Priority | null })}>
              <option value="">None</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {capitalize(p)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {thread.detached && (
          <div class="pp-notice" role="note">
            This comment's element was not found on the current page. Its snapshot is kept below.
            {host.reattach && (
              <button class="pp-btn pp-btn-sm" onClick={() => host.reattach!(thread.id)}>
                Re-attach
              </button>
            )}
          </div>
        )}
        {tickets.length > 0 && (
          <div class="pp-row pp-wrap pp-small">
            {tickets.map((t) => (
              <a key={t.url} href={t.url} target="_blank" rel="noopener noreferrer" class="pp-badge">
                {capitalize(t.kind)} · {t.externalId}
              </a>
            ))}
          </div>
        )}
      </header>

      {snapshots.length > 0 && (
        <section class="pp-snapshots" aria-label="Snapshots">
          <div class="pp-snap-strip">
            {snapshots.map((s) => (
              <SnapshotThumb key={s.id} snap={s} onOpen={() => setSnapOpen(s)} />
            ))}
          </div>
          {thread.snapshotHistory.length > snapshots.length && (
            <button class="pp-link-btn pp-small" onClick={() => setShowHistory(!showHistory)}>
              {showHistory ? 'Hide' : 'Show'} snapshot history ({thread.snapshotHistory.length - snapshots.length})
            </button>
          )}
          {showHistory && (
            <div class="pp-snap-strip">
              {thread.snapshotHistory
                .filter((s) => s.replacedAt)
                .map((s) => (
                  <SnapshotThumb key={s.id} snap={s} onOpen={() => setSnapOpen(s)} />
                ))}
            </div>
          )}
        </section>
      )}

      <section class="pp-comments" aria-label="Comments">
        {comments.map((c, i) => (
          <CommentItem
            key={c.id}
            comment={c}
            isFirst={i === 0}
            replyCount={replyCount}
            meId={meId}
            canDeleteAny={can(role, 'deleteAny')}
            members={members}
            onChanged={reload}
          />
        ))}
      </section>

      {can(role, 'comment') && (
        <Composer
          members={members}
          draftKey={draftKey({ workspaceId: thread.workspaceId, threadId: thread.id })}
          onSubmit={async (body, files) => {
            await host.postReply(thread.workspaceId, thread.id, body, files);
            reload();
          }}
        />
      )}

      <section class="pp-activity-wrap">
        <button class="pp-link-btn pp-small" aria-expanded={showActivity} onClick={() => setShowActivity(!showActivity)}>
          {showActivity ? 'Hide activity' : 'Show activity'}
        </button>
        {showActivity && <ActivityLog workspaceId={thread.workspaceId} threadId={thread.id} />}
      </section>

      {snapOpen && <SnapshotModal snap={snapOpen} onClose={() => setSnapOpen(null)} />}
    </article>
  );
}

function SnapshotThumb({ snap, onOpen }: { snap: Snapshot; onOpen: () => void }) {
  const label = { area: 'Selected area', viewport: 'Viewport', fullpage: 'Full page', dom: 'DOM snapshot' }[snap.kind];
  return (
    <button class="pp-snap-thumb" onClick={onOpen} aria-label={`Open ${label} snapshot`}>
      {snap.kind === 'dom' ? <span class="pp-snap-dom">{'</>'}</span> : <img src={snap.url} alt="" loading="lazy" />}
      <span class="pp-snap-label">
        {label}
        {snap.replacedAt ? ' (old)' : ''}
      </span>
    </button>
  );
}

export function SnapshotModal({ snap, onClose }: { snap: Snapshot; onClose: () => void }) {
  const c = snap.context;
  return (
    <Modal title="Snapshot" onClose={onClose} wide>
      <div class="pp-snap-full">
        {snap.kind === 'dom' ? (
          <iframe src={snap.url} sandbox="" title="DOM snapshot" class="pp-dom-frame" />
        ) : (
          <a href={snap.url} target="_blank" rel="noopener noreferrer">
            <img src={snap.url} alt={`Snapshot of ${c.pageTitle}`} />
          </a>
        )}
      </div>
      <dl class="pp-context">
        <dt>Page</dt>
        <dd>
          <a href={c.pageUrl} target="_blank" rel="noopener noreferrer">
            {c.pageTitle || c.pageUrl}
          </a>
        </dd>
        <dt>Captured</dt>
        <dd>{new Date(c.capturedAt || snap.capturedAt).toLocaleString()}</dd>
        <dt>Viewport</dt>
        <dd>
          {c.viewport.w} × {c.viewport.h} @ {c.dpr}x
        </dd>
        <dt>Browser</dt>
        <dd>{c.browser}</dd>
        <dt>OS</dt>
        <dd>{c.os}</dd>
        <dt>Scroll</dt>
        <dd>
          {Math.round(c.scroll.x)}, {Math.round(c.scroll.y)}
        </dd>
        {snap.replacedAt && (
          <>
            <dt>Replaced</dt>
            <dd>{new Date(snap.replacedAt).toLocaleString()}</dd>
          </>
        )}
      </dl>
    </Modal>
  );
}

function CommentItem({
  comment,
  isFirst,
  replyCount,
  meId,
  canDeleteAny,
  members,
  onChanged,
}: {
  comment: Comment;
  isFirst: boolean;
  replyCount: number;
  meId?: string;
  canDeleteAny: boolean;
  members: Member[];
  onChanged: () => void;
}) {
  const { host, toast, confirm } = useUi();
  const [editing, setEditing] = useState(false);
  const [c, setC] = useState(comment);
  useEffect(() => setC(comment), [comment]);
  const mine = c.authorId === meId;

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  if (c.deletedAt) {
    return (
      <div class="pp-comment pp-comment-deleted">
        <span class="pp-muted pp-small">Comment deleted</span>
        {(mine || canDeleteAny) && (
          <button class="pp-link-btn pp-small" onClick={() => act(async () => (setC(await host.api.restoreComment(c.id)), onChanged()))}>
            Restore
          </button>
        )}
      </div>
    );
  }

  const del = () =>
    act(async () => {
      const ok = await confirm(
        isFirst && replyCount > 0
          ? { title: 'Delete the first comment?', body: `This thread has ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}. The thread stays, but its opening comment is removed.`, confirmLabel: 'Delete', danger: true }
          : { title: 'Delete comment?', body: 'You can restore it for 30 days.', confirmLabel: 'Delete', danger: true },
      );
      if (!ok) return;
      await host.api.deleteComment(c.id);
      onChanged();
    });

  const react = (emoji: string) => act(async () => setC(await host.api.toggleReaction(c.id, emoji)));

  return (
    <div class="pp-comment">
      <div class="pp-comment-head">
        <Avatar user={c.author} />
        <strong>{c.author?.name || c.author?.email}</strong>
        <span class="pp-muted pp-small">
          <RelTime iso={c.createdAt} />
          {c.editedAt && <span title={new Date(c.editedAt).toLocaleString()}> · edited</span>}
        </span>
        <span class="pp-grow" />
        {(mine || canDeleteAny) && (
          <Menu
            label="Comment actions"
            icon="⋯"
            buttonClass="pp-icon-btn pp-icon-sm"
            items={[...(mine ? [{ label: 'Edit', onSelect: () => setEditing(true) }] : []), { label: 'Delete', onSelect: del, danger: true }]}
          />
        )}
      </div>
      {editing ? (
        <Composer
          members={members}
          initial={c.body}
          allowAttachments={false}
          submitLabel="Save"
          autoFocus
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            setC(await host.api.editComment(c.id, body));
            setEditing(false);
          }}
        />
      ) : (
        <div class="pp-body" dangerouslySetInnerHTML={{ __html: renderBody(c.body) }} />
      )}
      {c.attachments.length > 0 && (
        <div class="pp-attachments">
          {c.attachments.map((a) => (
            <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" title={a.name}>
              {a.contentType.startsWith('image/') ? <img src={a.url} alt={a.name} loading="lazy" /> : a.name}
            </a>
          ))}
        </div>
      )}
      <div class="pp-reactions">
        {c.reactions
          .filter((r) => r.userIds.length)
          .map((r) => (
            <button
              key={r.emoji}
              class={`pp-reaction ${meId && r.userIds.includes(meId) ? 'pp-active' : ''}`}
              aria-pressed={!!meId && r.userIds.includes(meId)}
              title={r.userIds.map((id) => members.find((m) => m.userId === id)?.user.name ?? 'Someone').join(', ')}
              onClick={() => react(r.emoji)}
            >
              {r.emoji} {r.userIds.length}
            </button>
          ))}
        <Menu label="Add reaction" icon="☺+" buttonClass="pp-reaction pp-reaction-add" items={REACTIONS.map((e) => ({ label: e, onSelect: () => react(e) }))} />
      </div>
    </div>
  );
}

export function ActivityLog({ workspaceId, threadId }: { workspaceId: string; threadId?: string }) {
  const { host } = useUi();
  const { data, error, loading, reload } = useAsync(() => host.api.activity(workspaceId, threadId), [workspaceId, threadId]);
  if (loading && !data) return <Skeleton rows={3} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.length) return <p class="pp-muted pp-small">No activity yet.</p>;
  return (
    <ol class="pp-activity">
      {data.map((a) => (
        <li key={a.id}>
          <strong>{a.actor?.name ?? 'System'}</strong> {describeActivity(a)} <span class="pp-muted"><RelTime iso={a.createdAt} /></span>
        </li>
      ))}
    </ol>
  );
}

export function describeActivity(a: ActivityEntry): string {
  const d = a.detail ?? {};
  switch (a.action) {
    case 'thread.created':
      return 'created the thread';
    case 'thread.resolved':
      return 'resolved the thread';
    case 'thread.reopened':
      return 'reopened the thread';
    case 'thread.assigned':
      return d.assigneeName ? `assigned it to ${d.assigneeName}` : 'changed the assignee';
    case 'thread.updated':
      return 'updated the thread';
    case 'thread.deleted':
      return 'deleted the thread';
    case 'thread.scope_changed':
      return `changed the scope${d.to ? ` to ${d.to}` : ''}`;
    case 'thread.reattached':
      return 're-attached the comment';
    case 'comment.created':
      return 'commented';
    case 'comment.edited':
      return 'edited a comment';
    case 'comment.deleted':
      return 'deleted a comment';
    case 'comment.restored':
      return 'restored a comment';
    case 'snapshot.replaced':
      return 'replaced a snapshot';
    case 'share.created':
      return 'created a share link';
    case 'share.revoked':
      return 'revoked a share link';
    default:
      return String(a.action);
  }
}
