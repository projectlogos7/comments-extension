// Comment text editor: auto-growing textarea that shows mentions as plain "@Name" (stored as
// @[Name](id) tokens only on save), a floating @mention picker (FR-2.2), formatting shortcuts
// (FR-2.4) and image paste/drop/attach (≤5 MB).
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Member } from '@pinpoint/shared';
import { activeMentionQuery, encodeMentions, filterCandidates, insertMention } from '@pinpoint/shared';
import { Popover } from './popover';

export interface PendingAttachment {
  name: string;
  dataUrl: string;
  size: number;
}

export const MAX_ATTACHMENT = 5 * 1024 * 1024;

export function initials(name: string) {
  return (
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]!.toUpperCase())
      .join('') || '?'
  );
}

export function Avatar({ name, url, size }: { name: string; url?: string | null; size?: number }) {
  const st = size ? `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px` : undefined;
  return (
    <span class="avatar" aria-hidden="true" style={st}>
      {url ? <img src={url} alt="" /> : initials(name)}
    </span>
  );
}

export function memberName(m: Member) {
  return m.user.name || m.user.email;
}

/** Display text -> stored body, resolving "@Name" against workspace members. */
export function toStoredBody(text: string, members: Member[]) {
  return encodeMentions(text.trim(), members.map((m) => ({ id: m.userId, name: memberName(m) })));
}

function readFile(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  members: Member[];
  placeholder?: string;
  autoFocus?: boolean;
  attachments: PendingAttachment[];
  onAttachments: (a: PendingAttachment[]) => void;
  onSubmit: () => void;
  onError: (msg: string) => void;
  /** Extra key handling (e.g. Alt+Arrow to step sections); return true when handled. */
  onExtraKey?: (e: KeyboardEvent) => boolean;
  label: string;
  minHeight?: number;
  /** Right side of the bottom bar (e.g. Send button). */
  actions?: ComponentChildren;
}

export function Editor(p: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (p.autoFocus) setTimeout(() => ta.current?.focus({ preventScroll: true }), 0);
  }, []);

  // Auto-grow.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, p.minHeight ?? 64), 240)}px`;
  }, [p.value]);

  const matches = useMemo(() => {
    if (query == null) return [];
    const list = p.members.map((m) => ({ id: m.userId, name: memberName(m), email: m.user.email, m }));
    return filterCandidates(list, query, 6);
  }, [query, p.members]);

  function syncQuery(el: HTMLTextAreaElement) {
    const q = activeMentionQuery(el.value, el.selectionStart);
    setQuery(q ? q.query : null);
    setActive(0);
  }

  function pickMention(m: Member) {
    const el = ta.current!;
    const r = insertMention(p.value, el.selectionStart, memberName(m));
    p.onChange(r.text);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.caret, r.caret);
    });
  }

  function wrap(left: string, right = left, placeholder = 'text') {
    const el = ta.current!;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    const sel = p.value.slice(s, e) || placeholder;
    p.onChange(p.value.slice(0, s) + left + sel + right + p.value.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + left.length, s + left.length + sel.length);
    });
  }

  function startMention() {
    const el = ta.current!;
    const s = el.selectionStart;
    const pre = p.value.slice(0, s);
    const ins = pre && !/\s$/.test(pre) ? ' @' : '@';
    const next = pre + ins + p.value.slice(el.selectionEnd);
    p.onChange(next);
    setQuery('');
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + ins.length, s + ins.length);
    });
  }

  async function addFiles(files: File[]) {
    const next = [...p.attachments];
    for (const f of files) {
      if (!f.type.startsWith('image/')) {
        p.onError('Only images can be attached.');
        continue;
      }
      if (f.size > MAX_ATTACHMENT) {
        p.onError(`${f.name || 'Image'} is larger than 5 MB.`);
        continue;
      }
      next.push({ name: f.name || `pasted-${Date.now()}.png`, dataUrl: await readFile(f), size: f.size });
    }
    p.onAttachments(next.slice(0, 10));
  }

  function onKeyDown(e: KeyboardEvent) {
    if (query != null && matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setActive((a) => (a + d + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(matches[active].m);
        return;
      }
    }
    if (p.onExtraKey?.(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !mod) {
      e.preventDefault();
      p.onSubmit();
    } else if (e.key === 'Enter' && mod) {
      e.preventDefault();
      p.onSubmit();
    } else if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') wrap('**');
      else if (k === 'i') wrap('*');
      else if (k === 'e') wrap('`', '`', 'code');
      else if (k === 'k') wrap('[', '](https://)', 'link');
      else return;
      e.preventDefault();
    }
  }

  const wrapRef = useRef<HTMLDivElement>(null);

  return (
    <div class="editor">
      <div ref={wrapRef} class="editor-box">
        <textarea
          ref={ta}
          rows={2}
          aria-label={p.label}
          placeholder={p.placeholder}
          value={p.value}
          aria-autocomplete="list"
          aria-expanded={query != null && matches.length > 0}
          onInput={(e) => {
            const t = e.currentTarget;
            p.onChange(t.value);
            syncQuery(t);
          }}
          onClick={(e) => syncQuery(e.currentTarget)}
          onKeyUp={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') syncQuery(e.currentTarget);
          }}
          onBlur={() => setTimeout(() => setQuery(null), 150)}
          onKeyDown={onKeyDown as unknown as (e: Event) => void}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files ?? []);
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const files = Array.from(e.dataTransfer?.files ?? []);
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
        />
        {p.attachments.length > 0 && (
          <div class="atts">
            {p.attachments.map((a, i) => (
              <div class="att" key={i}>
                <img src={a.dataUrl} alt={a.name} />
                <button type="button" aria-label={`Remove ${a.name}`} onClick={() => p.onAttachments(p.attachments.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <Popover anchor={wrapRef} open={query != null && matches.length > 0} onClose={() => setQuery(null)} class="mention-pop">
        <div role="listbox" aria-label="Mention a teammate">
          {matches.map((c, i) => (
            <div
              role="option"
              aria-selected={i === active}
              class={`opt ${i === active ? 'active' : ''}`}
              key={c.id}
              onPointerEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pickMention(c.m);
              }}
            >
              <Avatar name={c.name} url={c.m.user.avatarUrl} />
              <span class="opt-label">{c.name}</span>
              <span class="opt-hint">{c.email}</span>
            </div>
          ))}
        </div>
      </Popover>
      <div class="editor-bar">
        <div class="fmt" role="toolbar" aria-label="Formatting">
          <button type="button" title="Bold (Ctrl+B)" aria-label="Bold" onClick={() => wrap('**')}>
            <b>B</b>
          </button>
          <button type="button" title="Italic (Ctrl+I)" aria-label="Italic" onClick={() => wrap('*')}>
            <i>I</i>
          </button>
          <button type="button" title="Code (Ctrl+E)" aria-label="Inline code" onClick={() => wrap('`', '`', 'code')}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4 1.5 8l4 4M10.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <button type="button" title="Link (Ctrl+K)" aria-label="Link" onClick={() => wrap('[', '](https://)', 'link')}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 9.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.9.9M9.5 6.5a3 3 0 0 0-4.2 0L3 8.8a3 3 0 0 0 4.2 4.2l.9-.9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
          </button>
          <button type="button" title="Mention someone (@)" aria-label="Mention a teammate" onClick={startMention}>
            @
          </button>
          <button type="button" title="Attach image (or paste / drop)" aria-label="Attach image" onClick={() => file.current?.click()}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="m13.5 7.5-5.6 5.6a3.5 3.5 0 0 1-5-5l5.7-5.6a2.3 2.3 0 0 1 3.3 3.3L6.2 11.5a1.2 1.2 0 0 1-1.7-1.7l5.3-5.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
          </button>
          <input
            ref={file}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []);
              e.currentTarget.value = '';
              void addFiles(files);
            }}
          />
        </div>
        <span class="grow" />
        {p.actions}
      </div>
    </div>
  );
}
