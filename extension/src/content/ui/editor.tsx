// Comment text editor with @mention picker (FR-2.2), formatting buttons (FR-2.4) and image paste/drop.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Member } from '@pinpoint/shared';
import { mentionToken } from '@pinpoint/shared';

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

export function Avatar({ name, url }: { name: string; url?: string | null }) {
  return <span class="avatar" aria-hidden="true">{url ? <img src={url} alt="" /> : initials(name)}</span>;
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
  onCancel: () => void;
  onError: (msg: string) => void;
  /** Extra key handling (e.g. Alt+Arrow to step sections); return true when handled. */
  onExtraKey?: (e: KeyboardEvent) => boolean;
  label: string;
}

export function Editor(p: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (p.autoFocus) setTimeout(() => ta.current?.focus(), 0);
  }, []);

  const matches = useMemo(() => {
    if (query == null) return [];
    const q = query.toLowerCase();
    return p.members.filter((m) => m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().startsWith(q)).slice(0, 8);
  }, [query, p.members]);

  function detectMention(text: string, caret: number) {
    const before = text.slice(0, caret);
    const m = before.match(/(?:^|\s)@([^\s@\[\]()]{0,30})$/);
    setQuery(m ? m[1] : null);
    setActive(0);
  }

  function insertMention(m: Member) {
    const el = ta.current!;
    const caret = el.selectionStart;
    const before = p.value.slice(0, caret).replace(/@([^\s@\[\]()]{0,30})$/, '');
    const token = mentionToken(m.user.name || m.user.email, m.userId) + ' ';
    const next = before + token + p.value.slice(caret);
    p.onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = before.length + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function wrap(left: string, right = left, placeholder = 'text') {
    const el = ta.current!;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    const sel = p.value.slice(s, e) || placeholder;
    const next = p.value.slice(0, s) + left + sel + right + p.value.slice(e);
    p.onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + left.length, s + left.length + sel.length);
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
        insertMention(matches[active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setQuery(null);
        return;
      }
    }
    if (p.onExtraKey?.(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      p.onSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      p.onCancel();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrap('**');
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      wrap('*');
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      wrap('[', '](https://)', 'link');
    }
  }

  return (
    <div style="position:relative;display:flex;flex-direction:column;gap:6px">
      <div class="row" style="justify-content:space-between">
        <div class="fmt" role="toolbar" aria-label="Formatting">
          <button type="button" title="Bold (Ctrl+B)" aria-label="Bold" onClick={() => wrap('**')}><b>B</b></button>
          <button type="button" title="Italic (Ctrl+I)" aria-label="Italic" onClick={() => wrap('*')}><i>I</i></button>
          <button type="button" title="Inline code" aria-label="Inline code" onClick={() => wrap('`', '`', 'code')}>{'</>'}</button>
          <button type="button" title="Link (Ctrl+K)" aria-label="Link" onClick={() => wrap('[', '](https://)', 'link')}>🔗</button>
          <button type="button" title="Mention" aria-label="Mention a teammate" onClick={() => { p.onChange(p.value + (p.value && !/\s$/.test(p.value) ? ' @' : '@')); setQuery(''); ta.current?.focus(); }}>@</button>
        </div>
        <span class="muted">Enter to send · Shift+Enter new line</span>
      </div>
      <textarea
        ref={ta}
        aria-label={p.label}
        placeholder={p.placeholder}
        value={p.value}
        onInput={(e) => {
          const t = e.currentTarget;
          p.onChange(t.value);
          detectMention(t.value, t.selectionStart);
        }}
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
      {query != null && matches.length > 0 && (
        <div class="picker" role="listbox" aria-label="Mention a teammate" style="top:100%">
          {matches.map((m, i) => (
            <div role="option" aria-selected={i === active} key={m.id} onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}>
              <Avatar name={m.user.name || m.user.email} url={m.user.avatarUrl} />
              <span>{m.user.name}</span>
              <span class="muted">{m.user.email}</span>
            </div>
          ))}
        </div>
      )}
      {p.attachments.length > 0 && (
        <div class="atts">
          {p.attachments.map((a, i) => (
            <div class="att" key={i}>
              <img src={a.dataUrl} alt={a.name} />
              <button type="button" aria-label={`Remove ${a.name}`} onClick={() => p.onAttachments(p.attachments.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
