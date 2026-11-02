// In-page thread card (PRD §12 "Thread card"): read, reply, resolve, copy. Draggable; Esc closes.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Comment, CopyFormat, Member, Rect, ThreadDetail, User } from '@pinpoint/shared';
import { can, decodeMentions, draftKey, renderBody, type Role } from '@pinpoint/shared';
import { api, bg } from '../../lib/messaging';
import { Avatar, Editor, toStoredBody, type PendingAttachment } from './editor';
import { COPY_LABELS } from '../copy';
import { useDraggable, type Pos } from './drag';
import { pushLayer } from './layers';
import { MenuButton, type MenuItem } from './popover';

export interface CardProps {
  threadId: string;
  workspaceId: string;
  me: User;
  role: Role;
  members: Member[];
  anchorRect: () => Rect | null;
  detached: boolean;
  onClose: () => void;
  onCopy: (thread: ThreadDetail, format: CopyFormat) => void;
  onCopyText: (text: string, label: string) => void;
  onReattach: () => void;
  onChanged: () => void;
}

const CARD_W = 368;

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

function cardPos(r: Rect | null): Pos {
  if (!r) return { left: innerWidth - CARD_W - 24, top: 72 };
  let left = r.x + r.w + 16;
  if (left + CARD_W > innerWidth - 8) left = Math.max(8, r.x - CARD_W - 16);
  const top = Math.min(Math.max(8, r.y), Math.max(8, innerHeight - 460));
  return { left: Math.round(left), top: Math.round(top) };
}

const Dots = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <g fill="currentColor"><circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="13" cy="8" r="1.4" /></g>
  </svg>
);

function CommentView(p: {
  c: Comment;
  canEdit: boolean;
  canDelete: boolean;
  members: Member[];
  onDelete: () => void;
  onSaveEdit: (body: string) => Promise<void>;
  onError: (m: string) => void;
}) {
  const { c } = p;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [atts, setAtts] = useState<PendingAttachment[]>([]);
  if (c.deletedAt) return <div class="cmt deleted muted">Comment deleted</div>;
  const items: MenuItem[] = [];
  if (p.canEdit) items.push({ label: 'Edit', onSelect: () => (setText(decodeMentions(c.body)), setEditing(true)) });
  if (p.canDelete) items.push({ label: 'Delete', danger: true, onSelect: p.onDelete });
  return (
    <div class="cmt">
      <Avatar name={c.author.name || c.author.email} url={c.author.avatarUrl} size={26} />
      <div class="cmt-main">
        <div class="meta">
          <b>{c.author.name || c.author.email}</b>
          <span class="muted">
            {timeAgo(c.createdAt)}
            {c.editedAt ? ' · edited' : ''}
          </span>
          <span class="grow" />
          {items.length > 0 && !editing && (
            <MenuButton label="Comment actions" items={items} class="icon xs">
              <Dots />
            </MenuButton>
          )}
        </div>
        {editing ? (
          <Editor
            label="Edit comment"
            value={text}
            onChange={setText}
            members={p.members}
            autoFocus
            attachments={atts}
            onAttachments={setAtts}
            onError={p.onError}
            onSubmit={() => void p.onSaveEdit(toStoredBody(text, p.members)).then(() => setEditing(false))}
            minHeight={40}
            actions={
              <>
                <button type="button" class="btn sm ghost" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button type="button" class="btn sm primary" disabled={!text.trim()} onClick={() => void p.onSaveEdit(toStoredBody(text, p.members)).then(() => setEditing(false))}>
                  Save
                </button>
              </>
            }
          />
        ) : (
          <div class="text" dangerouslySetInnerHTML={{ __html: renderBody(c.body) }} />
        )}
        {c.attachments.length > 0 && (
          <div class="imgs">
            {c.attachments.map((a) => (
              <a href={a.url} target="_blank" rel="noopener noreferrer">
                <img src={a.url} alt={a.name} />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ThreadCard(p: CardProps) {
  const [t, setT] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [atts, setAtts] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const key = draftKey({ workspaceId: p.workspaceId, threadId: p.threadId });
  const drag = useDraggable(() => cardPos(p.anchorRect()));
  const replyRef = useRef(reply);
  replyRef.current = reply;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => pushLayer(() => p.onClose()), []);

  async function load() {
    try {
      const d = await api<ThreadDetail>('getThread', p.threadId);
      setT(d);
      if (d.unread) void api('markRead', p.threadId).catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    bg<string | null>({ type: 'drafts.get', key }).then((v) => v && setReply(v)).catch(() => undefined);
    const onChange = () => void load();
    window.addEventListener('pinpoint:thread-changed', onChange);
    return () => {
      window.removeEventListener('pinpoint:thread-changed', onChange);
      void bg({ type: 'drafts.set', key, value: replyRef.current.trim() ? replyRef.current : null }).catch(() => undefined);
    };
  }, [p.threadId]);

  useEffect(() => {
    const tm = setTimeout(() => bg({ type: 'drafts.set', key, value: reply.trim() ? reply : null }).catch(() => undefined), 500);
    return () => clearTimeout(tm);
  }, [reply]);

  async function send() {
    if (sending || (!reply.trim() && !atts.length)) return;
    setSending(true);
    setError(null);
    try {
      const r = await bg<Comment | { queued: true }>({
        type: 'comment.create',
        threadId: p.threadId,
        body: toStoredBody(reply, p.members),
        attachments: atts.map((a) => ({ name: a.name, dataUrl: a.dataUrl })),
      });
      setReply('');
      replyRef.current = '';
      setAtts([]);
      await bg({ type: 'drafts.set', key, value: null }).catch(() => undefined);
      if ('queued' in r) setError('Saved offline — it will sync when you are back online.');
      await load();
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
      p.onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function setStatus(status: 'open' | 'resolved') {
    try {
      setT(await api<ThreadDetail>('updateThread', p.threadId, { status }));
      p.onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function del(c: Comment, isFirst: boolean) {
    const replies = (t?.comments.filter((x) => !x.deletedAt).length ?? 1) - 1;
    if (isFirst && replies > 0 && !confirm('Delete the first comment? The replies stay in the thread.')) return;
    if (!isFirst && !confirm('Delete this comment?')) return;
    try {
      await api('deleteComment', c.id);
      await load();
      p.onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function edit(c: Comment, body: string) {
    try {
      await api('editComment', c.id, body);
      await load();
      p.onChanged();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }

  const resolveAllowed = t && (can(p.role, 'resolveAny') || (can(p.role, 'resolveOwn') && t.createdBy === p.me.id));
  const area = t?.snapshots.find((s) => s.kind === 'area');

  const moreItems: MenuItem[] = t
    ? [
        ...(Object.keys(COPY_LABELS) as CopyFormat[]).map((f) => ({ label: `Copy ${COPY_LABELS[f]}`, onSelect: () => p.onCopy(t, f) })),
        {
          label: 'Copy share link',
          separatorBefore: true,
          onSelect: async () => {
            try {
              const s = await api<{ url: string }>('shareThread', t.id);
              p.onCopyText(s.url, 'Link copied');
            } catch (e) {
              setError((e as Error).message);
            }
          },
        },
        { label: 'Open in side panel', onSelect: () => void bg({ type: 'sidepanel.open', threadId: p.threadId }).catch(() => undefined) },
        ...(p.detached ? [{ label: 'Re-attach to an element', onSelect: p.onReattach }] : []),
      ]
    : [];

  return (
    <div
      ref={drag.ref}
      class={`card card-ui ${drag.dragging ? 'dragging' : ''}`}
      role="dialog"
      aria-label={t ? `Comment thread #${t.number}` : 'Comment thread'}
      style={`left:${drag.pos.left}px;top:${drag.pos.top}px;width:${CARD_W}px`}
    >
      <div class="hdr drag-handle" {...drag.handleProps} title="Drag to move · double-click to reset">
        <span class={`num ${t?.status ?? 'open'}`}>{t ? t.number : '…'}</span>
        <div class="hdr-text">
          <span class="title">{t ? (t.status === 'open' ? 'Open' : 'Resolved') : 'Loading…'}</span>
          {t && (
            <span class="sub">
              {t.scope}
              {p.detached ? ' · detached' : ''}
              {t.assignee ? ` · → ${t.assignee.name}` : ''}
            </span>
          )}
        </div>
        <span class="grow" />
        {t && resolveAllowed && (
          <button
            type="button"
            class={`btn sm ${t.status === 'open' ? 'resolve' : 'ghost'}`}
            onClick={() => void setStatus(t.status === 'open' ? 'resolved' : 'open')}
            title={t.status === 'open' ? 'Mark as resolved' : 'Reopen thread'}
          >
            {t.status === 'open' ? '✓ Resolve' : 'Reopen'}
          </button>
        )}
        {t && (
          <MenuButton label="More actions" items={moreItems}>
            <Dots />
          </MenuButton>
        )}
        <button type="button" class="icon" aria-label="Close (Esc)" title="Close (Esc)" onClick={p.onClose}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        </button>
      </div>
      <div class="body" ref={listRef}>
        {error && (
          <div class="err" role="alert">
            {error}
          </div>
        )}
        {p.detached && (
          <div class="notice-inline">
            <span class="grow">The element this comment pointed at was not found. The snapshot shows what the reviewer saw.</span>
            <button type="button" class="btn sm" onClick={p.onReattach}>
              Re-attach
            </button>
          </div>
        )}
        {area && (
          <a href={area.url} target="_blank" rel="noopener noreferrer" class="thumb-link">
            <img class="thumb" src={area.url} alt="Snapshot of the commented area" />
          </a>
        )}
        {!t && !error && <div class="skeleton" aria-hidden="true" />}
        {t?.comments.map((c, i) => (
          <CommentView
            key={c.id}
            c={c}
            members={p.members}
            canEdit={c.authorId === p.me.id}
            canDelete={c.authorId === p.me.id || can(p.role, 'deleteAny')}
            onDelete={() => void del(c, i === 0)}
            onSaveEdit={(body) => edit(c, body)}
            onError={setError}
          />
        ))}
      </div>
      {t && (
        <div class="ftr reply">
          <Editor
            label="Reply"
            placeholder="Reply… type @ to mention"
            value={reply}
            onChange={setReply}
            members={p.members}
            attachments={atts}
            onAttachments={setAtts}
            onSubmit={() => void send()}
            onError={setError}
            minHeight={38}
            actions={
              <button type="button" class="btn sm primary" disabled={sending || (!reply.trim() && !atts.length)} onClick={() => void send()}>
                {sending ? 'Sending…' : 'Reply'}
              </button>
            }
          />
        </div>
      )}
    </div>
  );
}
