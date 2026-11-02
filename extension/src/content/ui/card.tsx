// Compact in-page thread card: read, reply, resolve, copy (PRD §12 "Thread card").
import { useEffect, useState } from 'preact/hooks';
import type { Comment, CopyFormat, Member, Rect, ThreadDetail, User } from '@pinpoint/shared';
import { can, draftKey, renderBody, type Role } from '@pinpoint/shared';
import { api, bg } from '../../lib/messaging';
import { Avatar, Editor, type PendingAttachment } from './editor';
import { COPY_LABELS } from '../copy';

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

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function CommentView({ c, canDelete, onDelete }: { c: Comment; canDelete: boolean; onDelete: () => void }) {
  if (c.deletedAt) return <div class="muted">Comment deleted</div>;
  return (
    <div class="cmt">
      <Avatar name={c.author.name || c.author.email} url={c.author.avatarUrl} />
      <div style="flex:1;min-width:0">
        <div class="meta">
          <b>{c.author.name}</b> · {timeAgo(c.createdAt)}
          {c.editedAt ? ' · edited' : ''}
          {canDelete && (
            <button type="button" class="icon" style="float:right;width:20px;height:20px" aria-label="Delete comment" title="Delete" onClick={onDelete}>
              🗑
            </button>
          )}
        </div>
        <div class="text" dangerouslySetInnerHTML={{ __html: renderBody(c.body) }} />
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
  const [menu, setMenu] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const key = draftKey({ workspaceId: p.workspaceId, threadId: p.threadId });

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
    return () => window.removeEventListener('pinpoint:thread-changed', onChange);
  }, [p.threadId]);

  useEffect(() => {
    const tm = setTimeout(() => bg({ type: 'drafts.set', key, value: reply || null }).catch(() => undefined), 400);
    return () => clearTimeout(tm);
  }, [reply]);

  useEffect(() => {
    const place = () => {
      const r = p.anchorRect();
      const W = 360;
      if (!r) return setPos({ left: innerWidth - W - 24, top: 72 });
      let left = r.x + r.w + 16;
      if (left + W > innerWidth - 8) left = Math.max(8, r.x - W - 16);
      const top = Math.min(Math.max(8, r.y), Math.max(8, innerHeight - 440));
      setPos({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, []);

  async function send() {
    if (sending || (!reply.trim() && !atts.length)) return;
    setSending(true);
    try {
      const r = await bg<Comment | { queued: true }>({ type: 'comment.create', threadId: p.threadId, body: reply.trim(), attachments: atts.map((a) => ({ name: a.name, dataUrl: a.dataUrl })) });
      setReply('');
      setAtts([]);
      await bg({ type: 'drafts.set', key, value: null }).catch(() => undefined);
      if ('queued' in r) setError('Saved offline — it will sync when you are back online.');
      await load();
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

  const resolveAllowed = t && (can(p.role, 'resolveAny') || (can(p.role, 'resolveOwn') && t.createdBy === p.me.id));

  return (
    <div class="card" role="dialog" aria-label={t ? `Comment thread #${t.number}` : 'Comment thread'} style={`left:${pos.left}px;top:${pos.top}px`}>
      <div class="hdr" style="position:relative">
        <span class="title">{t ? `#${t.number}` : 'Loading…'}</span>
        {t && <span class={`chip ${t.status}`}>{t.status === 'open' ? 'Open' : 'Resolved'}</span>}
        {p.detached && <span class="chip detached">Detached</span>}
        {t && <span class="chip">{t.scope}</span>}
        <button type="button" class="icon" aria-label="Copy as…" aria-haspopup="menu" aria-expanded={menu} title="Copy as" onClick={() => setMenu(!menu)}>
          ⧉
        </button>
        <button type="button" class="icon" aria-label="Open in side panel" title="Open in side panel" onClick={() => bg({ type: 'sidepanel.open', threadId: p.threadId }).catch(() => undefined)}>
          ⇥
        </button>
        <button type="button" class="icon" aria-label="Close" onClick={p.onClose}>
          ✕
        </button>
        {menu && t && (
          <div class="menu" role="menu">
            {(Object.keys(COPY_LABELS) as CopyFormat[]).map((f) => (
              <button type="button" role="menuitem" onClick={() => { setMenu(false); p.onCopy(t, f); }}>
                Copy {COPY_LABELS[f]}
              </button>
            ))}
            <hr />
            <button type="button" role="menuitem" onClick={async () => {
              setMenu(false);
              try {
                const s = await api<{ url: string }>('shareThread', t.id);
                p.onCopyText(s.url, 'Link copied');
              } catch (e) {
                setError((e as Error).message);
              }
            }}>
              Copy link
            </button>
          </div>
        )}
      </div>
      <div class="body">
        {error && <div class="err" role="alert">{error}</div>}
        {p.detached && (
          <div class="row">
            <span class="muted grow">The element this comment pointed at was not found. The snapshot shows what the reviewer saw.</span>
            <button type="button" class="btn sm" onClick={p.onReattach}>Re-attach</button>
          </div>
        )}
        {t?.snapshots.find((s) => s.kind === 'area') && (
          <a href={t.snapshots.find((s) => s.kind === 'area')!.url} target="_blank" rel="noopener noreferrer">
            <img class="thumb" src={t.snapshots.find((s) => s.kind === 'area')!.url} alt="Snapshot of the commented area" />
          </a>
        )}
        {t?.comments.map((c, i) => (
          <CommentView c={c} canDelete={c.authorId === p.me.id || can(p.role, 'deleteAny')} onDelete={() => void del(c, i === 0)} />
        ))}
        {t && (
          <Editor
            label="Reply"
            placeholder="Reply… (@ to mention)"
            value={reply}
            onChange={setReply}
            members={p.members}
            attachments={atts}
            onAttachments={setAtts}
            onSubmit={() => void send()}
            onCancel={p.onClose}
            onError={setError}
          />
        )}
      </div>
      <div class="ftr">
        {t && resolveAllowed && (
          <button type="button" class="btn" onClick={() => void setStatus(t.status === 'open' ? 'resolved' : 'open')}>
            {t.status === 'open' ? '✓ Resolve' : 'Reopen'}
          </button>
        )}
        <span class="grow" />
        <button type="button" class="btn primary" disabled={sending || (!reply.trim() && !atts.length)} onClick={() => void send()}>
          {sending ? 'Sending…' : 'Reply'}
        </button>
      </div>
    </div>
  );
}
