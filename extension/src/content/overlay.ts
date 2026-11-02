// Comment mode (FR-1.1–1.8, FR-3.2): hover outline with tag/class label, click to select, drag a
// free rectangle, shift+click to multi-select, arrow keys to walk parent/child, double-click for a
// section, Esc to leave. Works through open shadow roots and same-origin iframes.
import type { Rect, TextRangeRef } from '@pinpoint/shared';
import type { Host } from './host';
import { isGeneratedClass, normRect, rectContains, sectionCandidates, unionRects, viewportRect } from './anchor';

export interface Selection {
  scope: 'area' | 'section' | 'page';
  elements: Element[];
  freeRect: Rect | null;
  textRange: TextRangeRef | null;
  /** Selection rectangle in viewport coordinates at selection time (null for page scope). */
  rect: Rect | null;
  sections: Element[];
  sectionIndex: number;
}

interface Hit {
  el: Element;
}

function isOurs(el: Element | null, host: Host): boolean {
  return !!el && (el === host.el || host.el.contains(el));
}

/** Deepest element at a viewport point, piercing open shadow roots and same-origin iframes. */
export function deepElementAt(x: number, y: number, host: Host): Hit | null {
  let root: Document | ShadowRoot = document;
  let ox = 0;
  let oy = 0;
  let el: Element | null = null;
  for (let guard = 0; guard < 12; guard++) {
    const list = (root as Document).elementsFromPoint(x - ox, y - oy).filter((e) => !isOurs(e, host));
    const next: Element | undefined = list[0];
    if (!next || next === el) break;
    el = next;
    const sr = (el as HTMLElement).shadowRoot;
    if (sr && sr.mode === 'open' && 'elementsFromPoint' in sr) {
      const inner = sr.elementsFromPoint(x - ox, y - oy).find((e) => e !== el);
      if (inner && sr.contains(inner)) {
        root = sr;
        continue;
      }
    }
    if (el.tagName === 'IFRAME') {
      try {
        const doc = (el as HTMLIFrameElement).contentDocument;
        if (doc && doc.documentElement) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          ox += r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
          oy += r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
          root = doc;
          continue;
        }
      } catch {
        /* cross-origin: select the iframe itself */
      }
    }
    break;
  }
  if (!el) return null;
  const tag = el.tagName.toLowerCase();
  if (tag === 'html') return null;
  return { el };
}

export function describeEl(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id && el.id.length < 30 ? `#${el.id}` : '';
  const cls = Array.from(el.classList ?? [])
    .filter((c) => !isGeneratedClass(c))
    .slice(0, 2)
    .map((c) => '.' + c)
    .join('');
  const r = el.getBoundingClientRect();
  return `${tag}${id}${cls}  ${Math.round(r.width)}×${Math.round(r.height)}`;
}

function place(div: HTMLElement, r: Rect) {
  div.style.left = `${r.x}px`;
  div.style.top = `${r.y}px`;
  div.style.width = `${Math.max(0, r.w)}px`;
  div.style.height = `${Math.max(0, r.h)}px`;
}

export interface OverlayOptions {
  /** Shown in the mode bar, e.g. "Re-attach #3". */
  title?: string;
  onSelect: (sel: Selection) => void;
  onExit: () => void;
  /** Element the user right-clicked just before choosing "Comment here". */
  preselect?: Element | null;
}

export class Overlay {
  private hl: HTMLElement;
  private label: HTMLElement;
  private bar: HTMLElement;
  private multiEls: HTMLElement[] = [];
  private hovered: Element | null = null;
  private locked: Element | null = null;
  private lockTrail: Element[] = [];
  private multi: Element[] = [];
  private down: { x: number; y: number } | null = null;
  private dragging = false;
  private clickTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMove = { x: 0, y: 0 };
  active = false;

  constructor(
    private host: Host,
    private opts: OverlayOptions,
  ) {
    this.hl = document.createElement('div');
    this.hl.className = 'hl';
    this.label = document.createElement('div');
    this.label.className = 'hl-label';
    this.bar = document.createElement('div');
    this.bar.className = 'mode-bar';
    this.bar.setAttribute('role', 'toolbar');
    this.bar.innerHTML = '';
    const t = document.createElement('span');
    t.textContent = opts.title ?? 'Click an element or drag an area';
    const hints = document.createElement('span');
    hints.innerHTML = '<kbd>Shift</kbd>+click multi · <kbd>↑</kbd><kbd>↓</kbd> parent/child · dbl-click section · <kbd>Esc</kbd> exit';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.onclick = () => this.exit();
    this.bar.append(t, hints, cancel);
  }

  start() {
    if (this.active) return;
    this.active = true;
    const o = this.host.overlay;
    o.replaceChildren(this.hl, this.label, this.bar);
    o.classList.remove('hidden');
    this.hl.style.display = 'none';
    this.label.style.display = 'none';
    o.addEventListener('mousemove', this.onMove);
    o.addEventListener('mousedown', this.onDown);
    o.addEventListener('mouseup', this.onUp);
    o.addEventListener('dblclick', this.onDbl);
    o.addEventListener('wheel', this.onWheel, { passive: true });
    o.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKey, true);
    if (this.opts.preselect && this.opts.preselect.isConnected) {
      this.setHover(this.opts.preselect);
    }
  }

  private cleanup() {
    this.active = false;
    const o = this.host.overlay;
    o.classList.add('hidden');
    o.replaceChildren();
    o.removeEventListener('mousemove', this.onMove);
    o.removeEventListener('mousedown', this.onDown);
    o.removeEventListener('mouseup', this.onUp);
    o.removeEventListener('dblclick', this.onDbl);
    o.removeEventListener('wheel', this.onWheel);
    o.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKey, true);
    this.multiEls.forEach((e) => e.remove());
    this.multiEls = [];
    if (this.clickTimer) clearTimeout(this.clickTimer);
  }

  exit() {
    if (!this.active) return;
    this.cleanup();
    this.opts.onExit();
  }

  private finish(sel: Selection) {
    this.cleanup();
    this.opts.onSelect(sel);
  }

  private current(): Element | null {
    return this.locked ?? this.hovered;
  }

  private setHover(el: Element | null) {
    this.hovered = el;
    this.render();
  }

  private render() {
    const el = this.current();
    if (!el || this.dragging) {
      if (!this.dragging) {
        this.hl.style.display = 'none';
        this.label.style.display = 'none';
      }
      return;
    }
    const r = viewportRect(el);
    this.hl.className = 'hl';
    this.hl.style.display = 'block';
    place(this.hl, r);
    this.label.style.display = 'block';
    this.label.textContent = describeEl(el);
    const ly = r.y > 24 ? r.y - 22 : r.y + r.h + 4;
    this.label.style.left = `${Math.max(4, Math.min(r.x, innerWidth - 240))}px`;
    this.label.style.top = `${Math.max(4, Math.min(ly, innerHeight - 22))}px`;
  }

  private renderMulti() {
    this.multiEls.forEach((e) => e.remove());
    this.multiEls = this.multi.map((el) => {
      const d = document.createElement('div');
      d.className = 'hl multi';
      place(d, viewportRect(el));
      this.host.overlay.appendChild(d);
      return d;
    });
  }

  private onMove = (e: MouseEvent) => {
    if (this.down && (e.buttons & 1)) {
      const dist = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
      if (dist > 6 || this.dragging) {
        this.dragging = true;
        this.hl.className = 'hl drag';
        this.hl.style.display = 'block';
        this.label.style.display = 'none';
        place(this.hl, normRect(this.down.x, this.down.y, e.clientX, e.clientY));
        return;
      }
    }
    if (this.locked && Math.hypot(e.clientX - this.lastMove.x, e.clientY - this.lastMove.y) < 24) return;
    this.lastMove = { x: e.clientX, y: e.clientY };
    this.locked = null;
    this.lockTrail = [];
    const hit = deepElementAt(e.clientX, e.clientY, this.host);
    if (hit?.el !== this.hovered) this.setHover(hit?.el ?? null);
  };

  private onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    this.down = { x: e.clientX, y: e.clientY };
    this.dragging = false;
  };

  private onUp = (e: MouseEvent) => {
    if (e.button !== 0 || !this.down) return;
    const start = this.down;
    this.down = null;
    if (this.dragging) {
      this.dragging = false;
      const rect = normRect(start.x, start.y, e.clientX, e.clientY);
      if (rect.w < 8 || rect.h < 8) return this.render();
      this.finish(this.freeRectSelection(rect));
      return;
    }
    const el = this.current();
    if (!el) return;
    if (e.shiftKey) {
      const i = this.multi.indexOf(el);
      if (i >= 0) this.multi.splice(i, 1);
      else this.multi.push(el);
      this.renderMulti();
      return;
    }
    // Wait briefly so a double-click can turn this into a section selection.
    if (this.clickTimer) clearTimeout(this.clickTimer);
    this.clickTimer = setTimeout(() => {
      this.clickTimer = null;
      this.selectElement(el);
    }, 230);
  };

  private onDbl = (e: MouseEvent) => {
    e.preventDefault();
    if (this.clickTimer) clearTimeout(this.clickTimer);
    this.clickTimer = null;
    const el = this.current();
    if (!el) return;
    const sections = sectionCandidates(el);
    this.finish({ scope: 'section', elements: [el], freeRect: null, textRange: null, rect: viewportRect(sections[0] ?? el), sections, sectionIndex: 0 });
  };

  private onWheel = () => {
    // Let the page scroll under us: briefly stop catching pointer events.
    const o = this.host.overlay;
    o.style.pointerEvents = 'none';
    clearTimeout((this as unknown as { _wt: number })._wt);
    (this as unknown as { _wt: number })._wt = window.setTimeout(() => {
      o.style.pointerEvents = '';
      this.render();
      if (this.multi.length) this.renderMulti();
    }, 160);
  };

  private onContext = (e: MouseEvent) => {
    e.preventDefault();
    this.exit();
  };

  private onKey = (e: KeyboardEvent) => {
    if (!this.active) return;
    const handled = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if (e.key === 'Escape') {
      handled();
      if (this.multi.length) {
        this.multi = [];
        this.renderMulti();
      } else this.exit();
    } else if (e.key === 'ArrowUp') {
      const cur = this.current();
      const parent = cur?.parentElement;
      if (cur && parent && parent.tagName !== 'HTML') {
        handled();
        this.lockTrail.push(cur);
        this.locked = parent;
        this.render();
      }
    } else if (e.key === 'ArrowDown') {
      const cur = this.current();
      if (!cur) return;
      handled();
      const back = this.lockTrail.pop();
      const child = back && back.parentElement === cur ? back : cur.firstElementChild;
      if (child) {
        this.locked = child;
        this.render();
      }
    } else if (e.key === 'Enter') {
      const el = this.current();
      handled();
      if (this.multi.length) {
        if (el && !this.multi.includes(el)) this.multi.push(el);
        this.selectMulti();
      } else if (el) this.selectElement(el);
    }
  };

  private selectElement(el: Element) {
    if (this.multi.length) {
      if (!this.multi.includes(el)) this.multi.push(el);
      return this.selectMulti();
    }
    this.finish({ scope: 'area', elements: [el], freeRect: null, textRange: null, rect: viewportRect(el), sections: sectionCandidates(el), sectionIndex: 0 });
  }

  private selectMulti() {
    const els = [...this.multi];
    const rect = unionRects(els.map(viewportRect));
    this.finish({ scope: 'area', elements: els, freeRect: null, textRange: null, rect, sections: sectionCandidates(els[0]), sectionIndex: 0 });
  }

  /** A dragged rectangle is anchored to the smallest element that contains it. */
  private freeRectSelection(rect: Rect): Selection {
    const hit = deepElementAt(rect.x + rect.w / 2, rect.y + rect.h / 2, this.host);
    let el: Element = hit?.el ?? document.body;
    while (el.parentElement && el.tagName !== 'BODY' && !rectContains(viewportRect(el), rect, 4)) el = el.parentElement;
    return { scope: 'area', elements: [el], freeRect: rect, textRange: null, rect, sections: sectionCandidates(el), sectionIndex: 0 };
  }
}
