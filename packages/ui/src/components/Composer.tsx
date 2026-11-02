import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { mentionToken, type Member } from '@pinpoint/shared';
import { errorMessage, useUi } from '../context';
import { Avatar } from './common';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** If the caret is inside an "@query" being typed, return its start index and query. */
export function findMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = before.match(/(^|[\s(])@([^\s@\[\]()]{0,40})$/);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}

/** Replace "@query" at [start, caret) with a mention token; returns new text and caret. */
export function insertMention(text: string, start: number, caret: number, member: Pick<Member, 'userId'> & { user: { name: string; email: string } }) {
  const token = mentionToken(member.user.name || member.user.email, member.userId) + ' ';
  const next = text.slice(0, start) + token + text.slice(caret);
  return { text: next, caret: start + token.length };
}

export function filterMembers(members: Member[], query: string): Member[] {
  const q = query.toLowerCase();
  return members
    .filter((m) => !q || m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q))
    .slice(0, 8);
}

/** Wrap the current selection of a textarea in markers (bold/italic/code/link). */
export function wrapSelection(text: string, start: number, end: number, before: string, after = before) {
  const sel = text.slice(start, end);
  const next = text.slice(0, start) + before + sel + after + text.slice(end);
  return { text: next, start: start + before.length, end: end + before.length };
}

export interface ComposerProps {
  members: Member[];
  draftKey?: string;
  placeholder?: string;
  submitLabel?: string;
  initial?: string;
  allowAttachments?: boolean;
  autoFocus?: boolean;
  onSubmit: (body: string, files: File[]) => Promise<void>;
  onCancel?: () => void;
}

export function Composer({ members, draftKey, placeholder = 'Reply… (@ to mention)', submitLabel = 'Reply', initial = '', allowAttachments = true, autoFocus, onSubmit, onCancel }: ComposerProps) {
  const { host, toast } = useUi();
  const [text, setText] = useState(initial);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  const draftTimer = useRef<number>();
  const listId = useMemo(() => `pp-mentions-${Math.random().toString(36).slice(2)}`, []);

  useEffect(() => {
    if (!draftKey || initial) return;
    host.getDraft(draftKey).then((d) => d && setText((t) => t || d)).catch(() => {});
  }, [draftKey]);

  useEffect(() => {
    if (autoFocus) ta.current?.focus();
  }, [autoFocus]);

  const matches = mention ? filterMembers(members, mention.query) : [];

  const update = (value: string, caret: number) => {
    setText(value);
    setMention(findMentionQuery(value, caret));
    setActive(0);
    if (draftKey) {
      clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => host.setDraft(draftKey, value.trim() ? value : null).catch(() => {}), 400) as unknown as number;
    }
  };

  const pick = (m: Member) => {
    if (!mention || !ta.current) return;
    const caret = ta.current.selectionStart;
    const r = insertMention(text, mention.start, caret, m);
    update(r.text, r.caret);
    setMention(null);
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(r.caret, r.caret);
    });
  };

  const format = (before: string, after?: string) => {
    const el = ta.current;
    if (!el) return;
    const r = wrapSelection(text, el.selectionStart, el.selectionEnd, before, after);
    update(r.text, r.end);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.start, r.end);
    });
  };

  const addFiles = (list: FileList | File[] | null | undefined) => {
    const arr = [...(list ?? [])].filter((f) => f.type.startsWith('image/'));
    const tooBig = arr.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig.length) toast(`Images must be 5 MB or smaller (${tooBig.map((f) => f.name).join(', ')})`, 'error');
    const ok = arr.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    if (ok.length) setFiles((f) => [...f, ...ok].slice(0, 10));
  };

  const submit = async () => {
    const body = text.trim();
    if ((!body && !files.length) || busy) return;
    setBusy(true);
    try {
      await onSubmit(body, files);
      setText('');
      setFiles([]);
      if (draftKey) await host.setDraft(draftKey, null).catch(() => {});
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (mention && matches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => (a + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMention(null);
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      format('**');
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
      e.preventDefault();
      format('*');
    } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && onCancel) {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div class="pp-composer" onDragOver={(e) => allowAttachments && e.preventDefault()} onDrop={(e) => {
      if (!allowAttachments) return;
      e.preventDefault();
      addFiles(e.dataTransfer?.files);
    }}>
      <div class="pp-composer-tools" role="toolbar" aria-label="Formatting">
        <button type="button" class="pp-icon-btn" title="Bold (Ctrl+B)" aria-label="Bold" onClick={() => format('**')}>
          <b>B</b>
        </button>
        <button type="button" class="pp-icon-btn" title="Italic (Ctrl+I)" aria-label="Italic" onClick={() => format('*')}>
          <i>I</i>
        </button>
        <button type="button" class="pp-icon-btn" title="Inline code" aria-label="Inline code" onClick={() => format('`')}>
          {'</>'}
        </button>
        <button type="button" class="pp-icon-btn" title="Link" aria-label="Link" onClick={() => format('[', '](https://)')}>
          🔗
        </button>
        {allowAttachments && (
          <label class="pp-icon-btn" title="Attach image" aria-label="Attach image">
            📎
            <input type="file" accept="image/*" multiple hidden onChange={(e) => addFiles((e.target as HTMLInputElement).files)} />
          </label>
        )}
      </div>
      <div class="pp-composer-input">
        <textarea
          ref={ta}
          rows={2}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          role="combobox"
          aria-expanded={!!(mention && matches.length)}
          aria-controls={listId}
          aria-autocomplete="list"
          onInput={(e) => {
            const el = e.target as HTMLTextAreaElement;
            update(el.value, el.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            if (!allowAttachments) return;
            const imgs = [...(e.clipboardData?.files ?? [])];
            if (imgs.length) {
              e.preventDefault();
              addFiles(imgs);
            }
          }}
        />
        {mention && matches.length > 0 && (
          <ul class="pp-mention-list" id={listId} role="listbox" aria-label="Mention a teammate">
            {matches.map((m, i) => (
              <li
                key={m.id}
                role="option"
                aria-selected={i === active}
                class={i === active ? 'pp-active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
              >
                <Avatar user={m.user} size={20} />
                <span>{m.user.name || m.user.email}</span>
                <span class="pp-muted pp-small">{m.user.email}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {files.length > 0 && (
        <div class="pp-attach-previews">
          {files.map((f, i) => (
            <div class="pp-attach-preview" key={i}>
              <img src={URL.createObjectURL(f)} alt={f.name} />
              <button class="pp-icon-btn" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div class="pp-row pp-end">
        <span class="pp-muted pp-small pp-grow">Enter to send · Shift+Enter for a new line</span>
        {onCancel && (
          <button class="pp-btn pp-btn-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button class="pp-btn pp-btn-primary pp-btn-sm" disabled={busy || (!text.trim() && !files.length)} onClick={submit}>
          {busy ? 'Sending…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
