// Composer (FR-2.1, FR-2.9, FR-2.12, FR-3.1, FR-4.2, FR-4.10, FR-4.11): opens beside the selection.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentRef, Member, Priority, Rect, Scope, SnapshotContext, ThreadDetail, ThreadType, UrlMatch, User, Workspace } from '@pinpoint/shared';
import { PRIORITIES, THREAD_TYPES, draftKey } from '@pinpoint/shared';
import { bg } from '../../lib/messaging';
import { buildAnchor, viewportRect } from '../anchor';
import type { Selection } from '../overlay';
import { domSnapshot } from '../dom-snapshot';
import { Editor, type PendingAttachment } from './editor';
import { BlurEditor } from './blur';

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

const W = 340;

function position(rect: Rect | null): { left: number; top: number } {
  const vw = innerWidth;
  const vh = innerHeight;
  if (!rect) return { left: vw - W - 24, top: 72 };
  let left = rect.x + rect.w + 12;
  if (left + W > vw - 8) left = rect.x - W - 12;
  let top = rect.y;
  if (left < 8) {
    left = Math.min(Math.max(8, rect.x), vw - W - 8);
    top = rect.y + rect.h + 12;
    if (top + 320 > vh) top = Math.max(8, rect.y - 340);
  }
  top = Math.min(Math.max(8, top), Math.max(8, vh - 420));
  return { left: Math.max(8, left), top };
}

export function Composer(p: ComposerProps) {
  const ws = p.workspace;
  const privacy = ws.privacy;
  const [scope, setScope] = useState<Scope>(p.sel.scope);
  const [sectionIndex, setSectionIndex] = useState(p.sel.sectionIndex);
  const [body, setBody] = useState('');
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
  const [showMore, setShowMore] = useState(false);
  const key = draftKey({ workspaceId: ws.id, url: location.href });

  useEffect(() => {
    bg<string | null>({ type: 'drafts.get', key }).then((v) => v && setBody((b) => b || v)).catch(() => undefined);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => bg({ type: 'drafts.set', key, value: body || null }).catch(() => undefined), 400);
    return () => clearTimeout(t);
  }, [body]);

  const sections = p.sel.sections;
  const sectionEl = scope === 'section' ? sections[sectionIndex] ?? p.sel.elements[0] ?? null : null;
  useEffect(() => {
    p.onPreviewSection(sectionEl);
  }, [sectionEl, scope]);
  useEffect(() => {
    if (scope === 'page' && privacy.allowFullPage) setFullPage(true);
  }, [scope]);

  const pos = useMemo(() => position(p.sel.rect), []);
  const hasElement = p.sel.elements.length > 0;

  function stepSection(d: number) {
    if (!sections.length) return;
    setScope('section');
    setSectionIndex((i) => Math.max(0, Math.min(sections.length - 1, i + d)));
  }

  async function save(skipReview = false) {
    if (saving) return;
    if (!body.trim() && !attachments.length) {
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
      // Selection rectangle in the coordinates of the capture (page may have scrolled since).
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
          body: body.trim(),
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
      await bg({ type: 'drafts.set', key, value: null }).catch(() => undefined);
      p.onPreviewSection(null);
      p.onSaved(result);
    } catch (e) {
      setError((e as Error).message || 'Could not save the comment.');
      setSaving(false);
    }
  }

  if (blurOpen && p.capture.dataUrl) {
    return (
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
    );
  }

  return (
    <div class="composer" role="dialog" aria-label="New comment" style={`left:${pos.left}px;top:${pos.top}px`}>
      <div class="hdr">
        <span class="title">New comment</span>
        <div class="seg" role="group" aria-label="Scope">
          {(['area', 'section', 'page'] as Scope[]).map((s) => (
            <button
              type="button"
              aria-pressed={scope === s}
              disabled={s !== 'page' && !hasElement}
              title={s === 'section' ? 'Comment on the page section (Alt+↑/↓ to change)' : undefined}
              onClick={() => setScope(s)}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div class="body">
        {scope === 'section' && sections.length > 0 && (
          <div class="row">
            <span class="muted grow">
              Section {sectionIndex + 1}/{sections.length}: <b>{sectionEl?.tagName.toLowerCase()}</b>
            </span>
            <button type="button" class="btn sm" onClick={() => stepSection(-1)} disabled={sectionIndex === 0} aria-label="Smaller section">
              Smaller
            </button>
            <button type="button" class="btn sm" onClick={() => stepSection(1)} disabled={sectionIndex >= sections.length - 1} aria-label="Larger section">
              Larger
            </button>
          </div>
        )}
        {p.sel.textRange && scope === 'area' && <div class="muted">“{p.sel.textRange.text.slice(0, 120)}”</div>}
        <Editor
          label="Comment"
          placeholder="What should change? Type @ to mention someone"
          value={body}
          onChange={setBody}
          members={p.members}
          autoFocus
          attachments={attachments}
          onAttachments={setAttachments}
          onSubmit={() => void save()}
          onCancel={p.onCancel}
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
        <div class="row">
          <label class="muted" for="pp-match">Show on</label>
          <select id="pp-match" value={urlMatch} onChange={(e) => setUrlMatch(e.currentTarget.value as UrlMatch)}>
            <option value="exact">This exact URL</option>
            <option value="path">This page (any query)</option>
            <option value="site">Every page on this site</option>
          </select>
          <button type="button" class="btn sm" aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>
            {showMore ? 'Fewer options' : 'More options'}
          </button>
        </div>
        {showMore && (
          <div class="row">
            <select aria-label="Type" value={type} onChange={(e) => setType(e.currentTarget.value as ThreadType)}>
              <option value="">Type…</option>
              {THREAD_TYPES.map((t) => (
                <option value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
            <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.currentTarget.value as Priority)}>
              <option value="">Priority…</option>
              {PRIORITIES.map((t) => (
                <option value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
            <select aria-label="Assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.currentTarget.value)}>
              <option value="">Assign…</option>
              {p.members
                .filter((m) => m.role !== 'guest')
                .map((m) => (
                  <option value={m.userId}>{m.userId === p.me.id ? `${m.user.name} (me)` : m.user.name}</option>
                ))}
            </select>
          </div>
        )}
        <div class="row">
          <label class="chk" title={privacy.allowFullPage ? '' : 'Disabled by your workspace admin'}>
            <input type="checkbox" checked={fullPage} disabled={!privacy.allowFullPage} onChange={(e) => setFullPage(e.currentTarget.checked)} />
            Full-page snapshot
          </label>
          {privacy.allowDom && hasElement && scope !== 'page' && (
            <label class="chk">
              <input type="checkbox" checked={withDom} onChange={(e) => setWithDom(e.currentTarget.checked)} />
              DOM snapshot
            </label>
          )}
        </div>
        {p.capture.dataUrl && (
          <div class="row">
            <img class="thumb" src={blurred ?? p.capture.dataUrl} alt="Snapshot preview" style="flex:1;width:0" />
          </div>
        )}
        {error && <div class="err" role="alert">{error}</div>}
      </div>
      <div class="ftr">
        {p.capture.dataUrl && (
          <button type="button" class="btn sm" onClick={() => setBlurOpen(true)}>
            Blur…{blurRegions.length ? ` (${blurRegions.length})` : ''}
          </button>
        )}
        <span class="grow" />
        <button type="button" class="btn" onClick={p.onCancel}>
          Cancel
        </button>
        <button type="button" class="btn primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Comment'}
        </button>
      </div>
    </div>
  );
}
