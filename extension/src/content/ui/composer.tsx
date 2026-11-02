// Composer (FR-2.1, FR-2.9, FR-2.12, FR-3.1, FR-4.2, FR-4.10, FR-4.11): a compact, draggable card
// beside the selection. Default view is just the text box and Send; everything else sits under
// "Options". Esc closes it (the draft is kept).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentRef, Member, Priority, Rect, Scope, SnapshotContext, ThreadDetail, ThreadType, UrlMatch, User, Workspace } from '@pinpoint/shared';
import { PRIORITIES, THREAD_TYPES, draftKey } from '@pinpoint/shared';
import { bg } from '../../lib/messaging';
import { buildAnchor, viewportRect } from '../anchor';
import type { Selection } from '../overlay';
import { domSnapshot } from '../dom-snapshot';
import { Avatar, Editor, memberName, toStoredBody, type PendingAttachment } from './editor';
import { BlurEditor } from './blur';
import { useDraggable, type Pos } from './drag';
import { pushLayer } from './layers';
import { Select, type Option } from './popover';

export interface Capture {
  dataUrl: string | null;
  context: SnapshotContext;
  scroll: { x: number; y: number };
  viewport: { w: number; h: number; dpr: number };
}

export interface ComposerProps {
  sel: Selection;
  capture: Capture;
  workspace: Workspace;
  members: Member[];
  me: User;
  component: Promise<ComponentRef | null>;
  onPreviewSection: (el: Element | null) => void;
  onSaved: (result: ThreadDetail | { queued: true }) => void;
  onCancel: () => void;
}

export const COMPOSER_W = 352;

/** Beside the selection (right, else left, else below/above), clamped to the viewport. */
export function besideRect(rect: Rect | null, w = COMPOSER_W, h = 220): Pos {
  const vw = innerWidth;
  const vh = innerHeight;
  if (!rect) return { left: vw - w - 24, top: 72 };
  let left = rect.x + rect.w + 12;
  let top = rect.y;
  if (left + w > vw - 8) left = rect.x - w - 12;
  if (left < 8) {
    left = Math.min(Math.max(8, rect.x), vw - w - 8);
    top = rect.y + rect.h + 12;
    if (top + h > vh - 8) top = rect.y - h - 12;
  }
  return { left: Math.round(Math.max(8, Math.min(left, vw - w - 8))), top: Math.round(Math.min(Math.max(8, top), Math.max(8, vh - h - 8))) };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const PRIORITY_COLOR: Record<Priority, string> = { low: '#8b8d98', medium: '#d97706', high: '#dc2626' };
const TYPE_ICON: Record<ThreadType, string> = { bug: '🐞', content: '✎', design: '◆', question: '?', other: '•' };

const MATCH_OPTIONS: Option<UrlMatch>[] = [
  { value: 'path', label: 'This page', hint: 'any query string' },
  { value: 'exact', label: 'This exact URL' },
  { value: 'site', label: 'Whole site', hint: 'every page' },
];

export function Composer(p: ComposerProps) {
  const ws = p.workspace;
  const privacy = ws.privacy;
  const hasElement = p.sel.elements.length > 0 || !!p.sel.freeRect;
  const [scope, setScope] = useState<Scope>(p.sel.scope);
  const [sectionIndex, setSectionIndex] = useState(p.sel.sectionIndex);
  const [text, setText] = useState('');
  const [urlMatch, setUrlMatch] = useState<UrlMatch>('path');
  const [type, setType] = useState<ThreadType | ''>('');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [assigneeId, setAssigneeId] = useState('');
  const [fullPage, setFullPage] = useState(p.sel.scope === 'page' && privacy.allowFullPage);
  const [withDom, setWithDom] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [blurOpen, setBlurOpen] = useState(false);
  const [blurRegions, setBlurRegions] = useState<Rect[]>([]);
  const [blurred, setBlurred] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const key = draftKey({ workspaceId: ws.id, url: location.href });
  const textRef = useRef(text);
  textRef.current = text;
  const saved = useRef(false);

  const drag = useDraggable(() => besideRect(p.sel.rect));

  // Esc closes the composer (unless a dropdown or the blur editor is on top of it).
  useEffect(() => pushLayer(() => p.onCancel()), []);

  // Drafts (FR-2.12): restore, autosave, and flush on close so Esc never loses text.
  useEffect(() => {
    bg<string | null>({ type: 'drafts.get', key }).then((v) => v && setText((b) => b || v)).catch(() => undefined);
    return () => {
      if (!saved.current) void bg({ type: 'drafts.set', key, value: textRef.current.trim() ? textRef.current : null }).catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    const t = setTimeout(() => bg({ type: 'drafts.set', key, value: text.trim() ? text : null }).catch(() => undefined), 500);
    return () => clearTimeout(t);
  }, [text]);

  const sections = p.sel.sections;
  const sectionEl = scope === 'section' ? (sections[sectionIndex] ?? p.sel.elements[0] ?? null) : null;
  useEffect(() => {
    p.onPreviewSection(sectionEl);
  }, [sectionEl, scope]);
  useEffect(() => {
    if (scope === 'page' && privacy.allowFullPage) setFullPage(true);
  }, [scope]);

  function stepSection(d: number) {
    if (!sections.length) return;
    setScope('section');
    setSectionIndex((i) => Math.max(0, Math.min(sections.length - 1, i + d)));
  }

  async function save(skipReview = false) {
    if (saving) return;
    if (!text.trim() && !attachments.length) {
      setError('Write a comment first.');
      return;
    }
    if (privacy.requireBlurReview && !reviewed && !skipReview && p.capture.dataUrl) {
      setBlurOpen(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const component = await p.component;
      const elements = scope === 'page' ? [] : scope === 'section' && sectionEl ? [sectionEl] : p.sel.elements;
      const anchor = buildAnchor({
        scope,
        urlMatch,
        elements,
        freeRect: scope === 'area' ? p.sel.freeRect : null,
        textRange: scope === 'area' ? p.sel.textRange : null,
        component: scope === 'page' ? null : component,
        viewport: p.capture.viewport,
        scroll: p.capture.scroll,
      });
      let areaRect: Rect | null = null;
      if (scope === 'area') areaRect = p.sel.rect;
      else if (scope === 'section' && sectionEl) {
        const r = viewportRect(sectionEl);
        areaRect = { x: r.x + (scrollX - p.capture.scroll.x), y: r.y + (scrollY - p.capture.scroll.y), w: r.w, h: r.h };
      }
      const docBlur = blurRegions.map((r) => ({ x: r.x + p.capture.scroll.x, y: r.y + p.capture.scroll.y, w: r.w, h: r.h }));
      const result = await bg<ThreadDetail | { queued: true }>({
        type: 'thread.create',
        input: {
          url: location.href,
          title: document.title,
          scope,
          urlMatch,
          anchor,
          body: toStoredBody(text, p.members),
          type: type || null,
          priority: priority || null,
          assigneeId: assigneeId || null,
        },
        snapshot: {
          viewportDataUrl: blurred ?? p.capture.dataUrl ?? undefined,
          areaRect,
          fullPage: fullPage && privacy.allowFullPage,
          blurRegions: docBlur,
          domSnapshot: withDom && privacy.allowDom && elements[0] ? domSnapshot(elements[0]) : undefined,
          context: p.capture.context,
        },
        attachments: attachments.map((a) => ({ name: a.name, dataUrl: a.dataUrl })),
      });
      saved.current = true;
      await bg({ type: 'drafts.set', key, value: null }).catch(() => undefined);
      p.onPreviewSection(null);
      p.onSaved(result);
    } catch (e) {
      setError((e as Error).message || 'Could not save the comment.');
      setSaving(false);
    }
  }

  const assignees: Option<string>[] = p.members
    .filter((m) => m.role !== 'guest')
    .map((m) => ({ value: m.userId, label: m.userId === p.me.id ? `${memberName(m)} (me)` : memberName(m), icon: <Avatar name={memberName(m)} url={m.user.avatarUrl} size={18} /> }));
  const optionCount = [type, priority, assigneeId].filter(Boolean).length + (urlMatch !== 'path' ? 1 : 0) + (fullPage ? 1 : 0) + (withDom ? 1 : 0) + blurRegions.length;

  return (
    <>
      <div
        ref={drag.ref}
        class={`composer card-ui ${drag.dragging ? 'dragging' : ''}`}
        role="dialog"
        aria-label="New comment"
        style={`left:${drag.pos.left}px;top:${drag.pos.top}px;width:${COMPOSER_W}px`}
      >
        <div class="hdr drag-handle" {...drag.handleProps} title="Drag to move · double-click to reset">
          <span class="grip" aria-hidden="true">
            <svg width="8" height="14" viewBox="0 0 8 14"><g fill="currentColor"><circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" /><circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" /><circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" /></g></svg>
          </span>
          <div class="seg" role="radiogroup" aria-label="Comment on">
            {(['area', 'section', 'page'] as Scope[]).map((s) => (
              <button
                type="button"
                role="radio"
                aria-checked={scope === s}
                disabled={s !== 'page' && !hasElement}
                title={s === 'area' ? 'The selected element or area' : s === 'section' ? 'The page section around it (Alt+↑/↓ to change)' : 'The whole page'}
                onClick={() => setScope(s)}
              >
                {cap(s)}
              </button>
            ))}
          </div>
          <span class="grow" />
          <button type="button" class="icon" aria-label="Close (Esc)" title="Close (Esc) — your draft is kept" onClick={p.onCancel}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
          </button>
        </div>

        <div class="body">
          {scope === 'section' && sections.length > 0 && (
            <div class="row section-step">
              <span class="muted grow">
                Section {sectionIndex + 1} of {sections.length} · <code>{sectionEl?.tagName.toLowerCase()}</code>
              </span>
              <button type="button" class="btn sm ghost" onClick={() => stepSection(-1)} disabled={sectionIndex === 0}>
                Smaller
              </button>
              <button type="button" class="btn sm ghost" onClick={() => stepSection(1)} disabled={sectionIndex >= sections.length - 1}>
                Larger
              </button>
            </div>
          )}
          {p.sel.textRange && scope === 'area' && <blockquote class="quote">{p.sel.textRange.text.slice(0, 160)}</blockquote>}
          <Editor
            label="Comment"
            placeholder="Add a comment… type @ to mention"
            value={text}
            onChange={(v) => {
              setText(v);
              if (error) setError(null);
            }}
            members={p.members}
            autoFocus
            attachments={attachments}
            onAttachments={setAttachments}
            onSubmit={() => void save()}
            onError={setError}
            onExtraKey={(e) => {
              if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                stepSection(e.key === 'ArrowUp' ? 1 : -1);
                return true;
              }
              return false;
            }}
          />

          {showOptions && (
            <div class="options" id="pp-options">
              <div class="chips">
                <Select
                  label="Type"
                  value={type}
                  clearable
                  onChange={setType}
                  options={THREAD_TYPES.map((t) => ({ value: t, label: cap(t), icon: <span class="ticon" aria-hidden="true">{TYPE_ICON[t]}</span> }))}
                />
                <Select
                  label="Priority"
                  value={priority}
                  clearable
                  onChange={setPriority}
                  options={PRIORITIES.map((t) => ({ value: t, label: cap(t), icon: <span class="dot" style={`background:${PRIORITY_COLOR[t]}`} aria-hidden="true" /> }))}
                />
                <Select label="Assignee" value={assigneeId} clearable onChange={setAssigneeId} options={assignees} />
                <Select label="Show on" value={urlMatch} onChange={(v) => setUrlMatch((v || 'path') as UrlMatch)} options={MATCH_OPTIONS} />
              </div>
              <div class="snap-row">
                {p.capture.dataUrl ? (
                  <img class="thumb-sm" src={blurred ?? p.capture.dataUrl} alt="Snapshot preview" />
                ) : (
                  <div class="thumb-sm empty" aria-hidden="true">No snapshot</div>
                )}
                <div class="snap-opts">
                  <label class="chk" title={privacy.allowFullPage ? 'Scroll and capture the whole page' : 'Disabled by your workspace admin'}>
                    <input type="checkbox" checked={fullPage} disabled={!privacy.allowFullPage} onChange={(e) => setFullPage(e.currentTarget.checked)} />
                    Full-page snapshot
                  </label>
                  {privacy.allowDom && p.sel.elements.length > 0 && scope !== 'page' && (
                    <label class="chk" title="Sanitized HTML and styles of the element, for developers">
                      <input type="checkbox" checked={withDom} onChange={(e) => setWithDom(e.currentTarget.checked)} />
                      Include element HTML
                    </label>
                  )}
                  {p.capture.dataUrl && (
                    <button type="button" class="linkbtn" onClick={() => setBlurOpen(true)}>
                      {blurRegions.length ? `Blurred ${blurRegions.length} area${blurRegions.length > 1 ? 's' : ''} · edit` : 'Blur sensitive parts…'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {error && (
            <div class="err" role="alert">
              {error}
            </div>
          )}
        </div>

        <div class="ftr">
          <button
            type="button"
            class={`linkbtn opts-toggle ${showOptions ? 'on' : ''}`}
            aria-expanded={showOptions}
            aria-controls="pp-options"
            onClick={() => setShowOptions(!showOptions)}
          >
            Options{optionCount ? ` · ${optionCount}` : ''}
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={showOptions ? 'transform:rotate(180deg)' : ''}><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
          </button>
          <span class="grow" />
          <span class="kbd-hint" aria-hidden="true">↵ send</span>
          <button type="button" class="btn primary" disabled={saving || (!text.trim() && !attachments.length)} onClick={() => void save()}>
            {saving ? 'Sending…' : 'Comment'}
          </button>
        </div>
      </div>
      {blurOpen && p.capture.dataUrl && (
        <BlurEditor
          dataUrl={p.capture.dataUrl}
          viewport={p.capture.viewport}
          initial={blurRegions}
          required={privacy.requireBlurReview}
          onCancel={() => setBlurOpen(false)}
          onApply={(regions, out) => {
            setBlurRegions(regions);
            setBlurred(regions.length ? out : null);
            setReviewed(true);
            setBlurOpen(false);
          }}
        />
      )}
    </>
  );
}
