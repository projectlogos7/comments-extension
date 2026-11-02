import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { activeMentionQuery, decodeMentions, encodeMentions, filterCandidates, insertMention, type Member, type MentionCandidate } from '@pinpoint/shared';
import { errorMessage, useUi } from '../context';
import { Avatar, Icon, Popover, useLayer } from './common';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** If the caret is inside an "@query" being typed, return its start index and query. */
export const findMentionQuery = activeMentionQuery;

/** Wrap the current selection of a textarea in markers (bold/italic/code/link). */
export function wrapSelection(text: string, start: number, end: number, before: string, after = before) {
  const sel = text.slice(start, end);
  const next = text.slice(0, start) + before + sel + after + text.slice(end);
  return { text: next, start: start + before.length, end: end + before.length };
}

interface Candidate extends MentionCandidate {
  email: string;
  member: Member;
}

export function mentionCandidates(members: Member[]): Candidate[] {
  return members.map((m) => ({ id: m.userId, name: m.user.name || m.user.email, email: m.user.email, member: m }));
}

export interface ComposerProps {
  members: Member[];
  draftKey?: string;
  placeholder?: string;
  submitLabel?: string;
  /** Stored body (with @[Name](id) tokens) to start from, e.g. when editing. */
  initial?: string;
  allowAttachments?: boolean;
  autoFocus?: boolean;
  /** Receives the stored body: "@Name" is converted back to mention tokens. */
  onSubmit: (body: string, files: File[]) => Promise<void>;
  onCancel?: () => void;
}

export function Composer({ members, draftKey, placeholder = 'Reply… type @ to mention someone', submitLabel = 'Reply', initial = '', allowAttachments = true, autoFocus, onSubmit, onCancel }: ComposerProps) {
  const { host, toast } = useUi();
  const [text, setText] = useState(() => decodeMentions(initial));
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>();
  const listId = useMemo(() => `pp-mentions-${Math.random().toString(36).slice(2, 8)}`, []);
  const candidates = useMemo(() => mentionCandidates(members), [members]);
  const previews = useMemo(() => files.map((f) => ({ f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  // Editing an existing comment: Esc cancels the edit.
  useLayer(!!onCancel, () => onCancel?.());

  useEffect(() => {
    if (!draftKey || initial) return;
    host
      .getDraft(draftKey)
      .then((d) => d && setText((t) => t || decodeMentions(d)))
      .catch(() => {});
  }, [draftKey]);

  useEffect(() => {
    if (autoFocus) {
      const el = ta.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }
  }, [autoFocus]);

  useEffect(() => {
    // Grow with content (up to a limit) instead of showing a scrollbar early.
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const matches = mention ? filterCandidates(candidates, mention.query, 6) : [];
  const pickerOpen = !!mention && matches.length > 0;

  const saveDraft = (value: string) => {
    if (!draftKey) return;
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => host.setDraft(draftKey, value.trim() ? encodeMentions(value, candidates) : null).catch(() => {}), 400);
  };

  const update = (value: string, caret: number) => {
    setText(value);
    setMention(activeMentionQuery(value, caret));
    setActive(0);
    saveDraft(value);
  };

  const pick = (c: Candidate) => {
    const el = ta.current;
    if (!el) return;
    const r = insertMention(text, el.selectionStart, c.name);
    setText(r.text);
    setMention(null);
    saveDraft(r.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.caret, r.caret);
    });
  };

  const startMention = () => {
    const el = ta.current;
    if (!el) return;
    const pos = el.selectionStart;
    const needsSpace = pos > 0 && !/\s/.test(text[pos - 1]);
    const ins = (needsSpace ? ' ' : '') + '@';
    const value = text.slice(0, pos) + ins + text.slice(el.selectionEnd);
    update(value, pos + ins.length);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos + ins.length, pos + ins.length);
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
    const raw = text.trim();
    if ((!raw && !files.length) || busy) return;
    setBusy(true);
    try {
      await onSubmit(encodeMentions(raw, candidates), files);
      setText('');
      setFiles([]);
      setMention(null);
      clearTimeout(draftTimer.current);
      if (draftKey) await host.setDraft(draftKey, null).catch(() => {});
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const closePicker = useCallback(() => setMention(null), []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (pickerOpen) {
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
    }
  };

  const canSend = !busy && (!!text.trim() || files.length > 0);

  return (
    <div
      class={`pp-composer ${busy ? 'pp-busy' : ''}`}
      onDragOver={(e) => allowAttachments && e.preventDefault()}
      onDrop={(e) => {
        if (!allowAttachments) return;
        e.preventDefault();
        addFiles(e.dataTransfer?.files);
      }}
    >
      <textarea
        ref={ta}
        rows={1}
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        role="combobox"
        aria-expanded={pickerOpen}
        aria-controls={pickerOpen ? listId : undefined}
        aria-activedescendant={pickerOpen ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        onInput={(e) => {
          const el = e.target as HTMLTextAreaElement;
          update(el.value, el.selectionStart);
        }}
        onClick={(e) => {
          const el = e.target as HTMLTextAreaElement;
          setMention(activeMentionQuery(el.value, el.selectionStart));
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
      <Popover open={pickerOpen} onClose={closePicker} anchor={ta.current} placement="bottom-start" keepFocus class="pp-mention-pop">
        <ul class="pp-listbox pp-mention-list" id={listId} role="listbox" aria-label="Mention a teammate">
          {matches.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              class={`pp-option ${i === active ? 'pp-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
            >
              <Avatar user={c.member.user} size={24} />
              <span class="pp-option-two">
                <span class="pp-option-label">{c.name}</span>
                {c.email !== c.name && <span class="pp-muted pp-small">{c.email}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Popover>
      {previews.length > 0 && (
        <div class="pp-attach-previews">
          {previews.map(({ f, url }, i) => (
            <div class="pp-attach-preview" key={url}>
              <img src={url} alt={f.name} />
              <button type="button" class="pp-attach-remove" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div class="pp-composer-bar">
        <div class="pp-composer-tools" role="toolbar" aria-label="Formatting">
          <button type="button" class="pp-icon-btn pp-icon-sm" title="Mention someone (@)" aria-label="Mention someone" onClick={startMention}>
            <Icon name="at" size={15} />
          </button>
          <button type="button" class="pp-icon-btn pp-icon-sm" title="Bold (Ctrl+B)" aria-label="Bold" onClick={() => format('**')}>
            <Icon name="bold" size={15} />
          </button>
          <button type="button" class="pp-icon-btn pp-icon-sm" title="Italic (Ctrl+I)" aria-label="Italic" onClick={() => format('*')}>
            <Icon name="italic" size={15} />
          </button>
          <button type="button" class="pp-icon-btn pp-icon-sm" title="Inline code" aria-label="Inline code" onClick={() => format('`')}>
            <Icon name="code" size={15} />
          </button>
          <button type="button" class="pp-icon-btn pp-icon-sm" title="Link" aria-label="Link" onClick={() => format('[', '](https://)')}>
            <Icon name="link" size={15} />
          </button>
          {allowAttachments && (
            <label class="pp-icon-btn pp-icon-sm" title="Attach image (or paste one)">
              <Icon name="paperclip" size={15} />
              <span class="pp-sr">Attach image</span>
              <input type="file" accept="image/*" multiple class="pp-sr" onChange={(e) => addFiles((e.target as HTMLInputElement).files)} />
            </label>
          )}
        </div>
        <span class="pp-grow" />
        {onCancel && (
          <button type="button" class="pp-btn pp-btn-sm pp-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" class="pp-btn pp-btn-primary pp-btn-sm" disabled={!canSend} onClick={submit} title="Enter to send · Shift+Enter for a new line">
          {busy ? 'Sending…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
