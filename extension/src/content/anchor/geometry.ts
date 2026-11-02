import type { Rect } from '@pinpoint/shared';

/** Offset of an element's frame relative to the top-level viewport (same-origin iframes only). */
export function frameOffset(el: Element): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let win: Window | null = el.ownerDocument?.defaultView ?? null;
  while (win) {
    let frameEl: Element | null = null;
    try {
      frameEl = win.frameElement;
    } catch {
      frameEl = null;
    }
    if (!frameEl) break;
    const r = frameEl.getBoundingClientRect();
    const cs = frameEl.ownerDocument.defaultView?.getComputedStyle(frameEl);
    x += r.left + (parseFloat(cs?.borderLeftWidth ?? '0') || 0) + (parseFloat(cs?.paddingLeft ?? '0') || 0);
    y += r.top + (parseFloat(cs?.borderTopWidth ?? '0') || 0) + (parseFloat(cs?.paddingTop ?? '0') || 0);
    win = frameEl.ownerDocument.defaultView;
  }
  return { x, y };
}

/** Element bounding box in top-level viewport coordinates. */
export function viewportRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  const o = frameOffset(el);
  return { x: r.left + o.x, y: r.top + o.y, w: r.width, h: r.height };
}

export function rangeViewportRect(range: Range): Rect {
  const r = range.getBoundingClientRect();
  const node = range.commonAncestorContainer;
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const o = el ? frameOffset(el) : { x: 0, y: 0 };
  return { x: r.left + o.x, y: r.top + o.y, w: r.width, h: r.height };
}

export function unionRects(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function toDocRect(r: Rect, win: Window = window): Rect {
  return { x: r.x + win.scrollX, y: r.y + win.scrollY, w: r.w, h: r.h };
}

export function rectContains(outer: Rect, inner: Rect, slack = 2): boolean {
  return inner.x >= outer.x - slack && inner.y >= outer.y - slack && inner.x + inner.w <= outer.x + outer.w + slack && inner.y + inner.h <= outer.y + outer.h + slack;
}

export function normRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export function isVisibleRect(r: Rect): boolean {
  return r.w > 0 || r.h > 0;
}
