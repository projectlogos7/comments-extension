// Building anchors from a selection (FR-1.10).
import type { Anchor, AnchorTarget, ComponentRef, Rect, Scope, TextRangeRef, UrlMatch } from '@pinpoint/shared';
import { fingerprintText } from '@pinpoint/shared';
import { cssEscape, rootOf, selectorCandidates, shadowHostChain, structuralPath, xpathFor, pathSelector } from './selector';
import { unionRects, viewportRect } from './geometry';
import { sectionInfo } from './section';

export function elementText(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    const i = el as HTMLInputElement;
    return fingerprintText(i.placeholder || i.getAttribute('aria-label') || i.name || '');
  }
  if (tag === 'img') return fingerprintText((el as HTMLImageElement).alt || el.getAttribute('src')?.split('/').pop() || '');
  const t = (el as HTMLElement).innerText ?? el.textContent ?? '';
  return fingerprintText(t || el.getAttribute('aria-label') || el.getAttribute('title') || '');
}

/** Selectors of the same-origin iframes leading from the top document to `el`'s document. */
export function frameChain(el: Element): string[] {
  const chain: string[] = [];
  let win: Window | null = el.ownerDocument.defaultView;
  while (win) {
    let fe: Element | null = null;
    try {
      fe = win.frameElement;
    } catch {
      fe = null;
    }
    if (!fe) break;
    const sel = selectorCandidates(fe, 1)[0] ?? pathSelector(fe) ?? structuralPath(fe);
    chain.unshift(sel);
    win = fe.ownerDocument.defaultView;
  }
  return chain;
}

export function trimmedHtml(el: Element, max = 2000): string {
  const html = el.outerHTML ?? '';
  if (html.length <= max) return html;
  const open = html.match(/^<[^>]+>/)?.[0] ?? '';
  const tag = el.tagName.toLowerCase();
  return `${open}${(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, Math.max(0, max - open.length - 40))}…</${tag}>`;
}

/**
 * Describe one element. `selRect` is the selected rectangle in top-level viewport coordinates;
 * defaults to the element's own box (a click selection).
 */
export function buildTarget(el: Element, selRect?: Rect, scroll = { x: globalThis.scrollX || 0, y: globalThis.scrollY || 0 }): AnchorTarget {
  const box = viewportRect(el);
  const sel = selRect ?? box;
  const frames = frameChain(el);
  const shadow = shadowHostChain(el);
  let selectors = selectorCandidates(el);
  if (!selectors.length) {
    const sp = structuralPath(el);
    selectors = [sp];
  }
  const target: AnchorTarget = {
    selectors,
    xpath: xpathFor(el),
    structuralPath: structuralPath(el),
    textFingerprint: elementText(el),
    tag: el.tagName.toLowerCase(),
    rect: {
      relX: box.w ? round((sel.x - box.x) / box.w) : 0,
      relY: box.h ? round((sel.y - box.y) / box.h) : 0,
      w: Math.round(sel.w),
      h: Math.round(sel.h),
    },
    docRect: { x: Math.round(sel.x + scroll.x), y: Math.round(sel.y + scroll.y), w: Math.round(sel.w), h: Math.round(sel.h) },
  };
  if (frames.length) target.frames = frames;
  if (shadow.hosts.length) target.shadowHosts = shadow.hosts;
  return target;
}

function round(n: number) {
  return Math.round(n * 10000) / 10000;
}

export function jsPathFor(t: AnchorTarget): string {
  let expr = 'document';
  for (const f of t.frames ?? []) expr += `.querySelector(${JSON.stringify(f)}).contentDocument`;
  for (const h of t.shadowHosts ?? []) expr += `.querySelector(${JSON.stringify(h)}).shadowRoot`;
  return `${expr}.querySelector(${JSON.stringify(t.selectors[0])})`;
}

export interface BuildAnchorInput {
  scope: Scope;
  urlMatch: UrlMatch;
  /** Selected elements (one for click/section, several for shift+click). Empty for page scope. */
  elements: Element[];
  /** Free rectangle (top-level viewport coords) when the user dragged instead of clicking. */
  freeRect?: Rect | null;
  textRange?: TextRangeRef | null;
  component?: ComponentRef | null;
  viewport?: { w: number; h: number; dpr: number };
  scroll?: { x: number; y: number };
}

export function currentViewport() {
  return { w: globalThis.innerWidth || 0, h: globalThis.innerHeight || 0, dpr: globalThis.devicePixelRatio || 1 };
}

export function buildAnchor(input: BuildAnchorInput): Anchor {
  const viewport = input.viewport ?? currentViewport();
  const scroll = input.scroll ?? { x: globalThis.scrollX || 0, y: globalThis.scrollY || 0 };
  const anchor: Anchor = { scope: input.scope, urlMatch: input.urlMatch, viewport };
  if (input.scope === 'page' || !input.elements.length) return anchor;

  const primary = input.elements[0];
  const targets = input.elements.map((el, i) => buildTarget(el, i === 0 && input.freeRect ? input.freeRect : undefined, scroll));
  Object.assign(anchor, targets[0]);
  if (input.freeRect) anchor.freeRect = true;
  if (targets.length > 1) {
    anchor.targets = targets;
    const u = unionRects(targets.map((t) => t.docRect));
    anchor.docRect = u;
  }
  if (input.textRange) anchor.textRange = input.textRange;
  if (input.scope === 'section') anchor.section = sectionInfo(primary);
  if (input.component) anchor.component = input.component;
  anchor.htmlSnippet = trimmedHtml(primary);
  anchor.jsPath = jsPathFor(targets[0]);
  return anchor;
}

export { cssEscape, rootOf };
