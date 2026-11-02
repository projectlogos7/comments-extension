// Numbered pins that follow their anchors on scroll, resize and DOM changes (FR-1.9, FR-1.12).
import type { AnchorStatus, Rect, Thread } from '@pinpoint/shared';
import { excerpt } from '@pinpoint/shared';
import { resolveAnchor, type ResolvedAnchor } from './anchor';
import type { Host } from './host';

export interface PinItem {
  thread: Thread;
  resolved: ResolvedAnchor;
  pin: HTMLButtonElement | null;
  outline: HTMLDivElement | null;
  /** Document y of the anchor at last layout (for page order). */
  docY: number;
  docX: number;
  detachedSince: number | null;
}

export class Pins {
  items = new Map<string, PinItem>();
  visible = true;
  private raf = 0;
  private mo: MutationObserver | null = null;
  private ro: ResizeObserver | null = null;
  private resolveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReport = '';

  constructor(
    private host: Host,
    private handlers: { onPinClick: (threadId: string) => void; onStatus: (s: AnchorStatus[]) => void },
  ) {
    window.addEventListener('scroll', this.schedule, { capture: true, passive: true });
    window.addEventListener('resize', this.schedule, { passive: true });
    this.ro = new ResizeObserver(this.schedule);
    this.ro.observe(document.documentElement);
    this.mo = new MutationObserver((records) => {
      if (records.every((r) => this.host.el.contains(r.target) || r.target === this.host.el)) return;
      this.schedule();
      this.scheduleResolve();
    });
    this.mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
  }

  destroy() {
    window.removeEventListener('scroll', this.schedule, { capture: true } as EventListenerOptions);
    window.removeEventListener('resize', this.schedule);
    this.mo?.disconnect();
    this.ro?.disconnect();
    cancelAnimationFrame(this.raf);
    this.host.pins.replaceChildren();
    this.items.clear();
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.host.pins.classList.toggle('hidden', !v);
    if (v) this.schedule();
  }

  setThreads(threads: Thread[]) {
    const keep = new Set(threads.map((t) => t.id));
    for (const [id, it] of this.items) {
      if (!keep.has(id)) {
        it.pin?.remove();
        it.outline?.remove();
        this.items.delete(id);
      }
    }
    for (const t of threads) {
      const prev = this.items.get(t.id);
      const anchorChanged = !prev || JSON.stringify(prev.thread.anchor) !== JSON.stringify(t.anchor);
      const resolved = anchorChanged ? resolveAnchor(document, t.anchor) : prev!.resolved;
      const item: PinItem = prev ?? { thread: t, resolved, pin: null, outline: null, docX: 0, docY: 0, detachedSince: null };
      item.thread = t;
      item.resolved = resolved;
      this.items.set(t.id, item);
      this.ensureElements(item);
    }
    this.schedule();
  }

  private ensureElements(it: PinItem) {
    const t = it.thread;
    if (it.resolved.state !== 'attached') {
      it.pin?.remove();
      it.outline?.remove();
      it.pin = null;
      it.outline = null;
      if (it.resolved.state === 'detached' && it.detachedSince == null) it.detachedSince = Date.now();
      return;
    }
    it.detachedSince = null;
    if (!it.outline) {
      it.outline = document.createElement('div');
      this.host.pins.appendChild(it.outline);
    }
    it.outline.className = `pin-outline ${t.scope === 'section' ? 'section' : 'area'}`;
    if (!it.pin) {
      const b = document.createElement('button');
      b.type = 'button';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handlers.onPinClick(t.id);
      });
      b.addEventListener('mouseenter', () => it.outline?.classList.add('show'));
      b.addEventListener('mouseleave', () => it.outline?.classList.remove('show'));
      b.addEventListener('focus', () => it.outline?.classList.add('show'));
      b.addEventListener('blur', () => it.outline?.classList.remove('show'));
      this.host.pins.appendChild(b);
      it.pin = b;
    }
    const pin = it.pin;
    pin.className = `pin ${t.status}${t.unread ? ' unread' : ''}`;
    pin.textContent = String(t.number);
    const first = t.firstComment ? excerpt(t.firstComment.body, 80) : '';
    pin.setAttribute('aria-label', `Comment ${t.number}, ${t.status}${t.unread ? ', unread' : ''}, by ${t.author?.name ?? 'unknown'}: ${first}`);
    pin.title = `#${t.number} ${t.author?.name ?? ''}: ${first}`;
  }

  schedule = () => {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.layout();
    });
  };

  private scheduleResolve() {
    if (this.resolveTimer) return;
    this.resolveTimer = setTimeout(() => {
      this.resolveTimer = null;
      this.reresolve(false);
    }, 450);
  }

  /** Re-resolve anchors whose elements left the DOM or that are detached (or all, when forced). */
  reresolve(all: boolean) {
    for (const it of this.items.values()) {
      const lost = it.resolved.state === 'detached' || it.resolved.elements.some((e) => !e.isConnected);
      if (all || lost) {
        it.resolved = resolveAnchor(document, it.thread.anchor);
        this.ensureElements(it);
      }
    }
    this.schedule();
  }

  private layout() {
    const vw = innerWidth;
    const vh = innerHeight;
    for (const it of this.items.values()) {
      if (it.resolved.state !== 'attached' || !it.pin) continue;
      let r: Rect | null = null;
      try {
        r = it.resolved.rect();
      } catch {
        r = null;
      }
      if (!r || (r.w === 0 && r.h === 0)) {
        it.pin.style.display = 'none';
        if (it.outline) it.outline.style.display = 'none';
        continue;
      }
      it.docX = r.x + scrollX;
      it.docY = r.y + scrollY;
      const px = Math.min(Math.max(r.x + r.w, 14), vw - 14);
      const py = Math.min(Math.max(r.y, 14), vh - 14);
      const offscreen = r.y + r.h < 0 || r.y > vh || r.x + r.w < 0 || r.x > vw;
      it.pin.style.display = offscreen ? 'none' : 'block';
      it.pin.style.left = `${px}px`;
      it.pin.style.top = `${py}px`;
      if (it.outline) {
        it.outline.style.display = offscreen ? 'none' : 'block';
        it.outline.style.left = `${r.x}px`;
        it.outline.style.top = `${r.y}px`;
        it.outline.style.width = `${r.w}px`;
        it.outline.style.height = `${r.h}px`;
      }
    }
    this.report();
  }

  statuses(): AnchorStatus[] {
    const list = [...this.items.values()];
    const ordered = list
      .filter((i) => i.resolved.state === 'attached')
      .sort((a, b) => a.docY - b.docY || a.docX - b.docX)
      .map((i) => i.thread.id);
    return list.map((i) => ({
      threadId: i.thread.id,
      state: i.resolved.state,
      score: Math.round(i.resolved.score * 100) / 100,
      order: i.resolved.state === 'page' ? -1 : i.resolved.state === 'detached' ? 100000 + i.thread.number : ordered.indexOf(i.thread.id),
    }));
  }

  private report() {
    const s = this.statuses();
    const key = JSON.stringify(s.map((x) => [x.threadId, x.state, x.order]));
    if (key === this.lastReport) return;
    this.lastReport = key;
    this.handlers.onStatus(s);
  }

  forceReport() {
    this.lastReport = '';
    this.report();
  }
}
