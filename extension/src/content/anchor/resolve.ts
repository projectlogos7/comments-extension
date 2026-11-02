// Re-finding anchors after the page changed (FR-1.12): try every signal, score candidates,
// and report "detached" below a confidence threshold. Never deletes anything.
import type { Anchor, AnchorTarget, Rect } from '@pinpoint/shared';
import { textSimilarity } from '@pinpoint/shared';
import { evalXpath, resolveRoot, type QueryRoot } from './selector';
import { elementText } from './build';
import { findSectionByInfo } from './section';
import { findTextRange } from './textrange';
import { unionRects, viewportRect } from './geometry';

export const DETACH_THRESHOLD = 0.55;

export interface ResolvedTarget {
  el: Element;
  score: number;
  via: 'selector' | 'xpath' | 'structural' | 'text' | 'section';
}

export interface ResolvedAnchor {
  state: 'attached' | 'detached' | 'page';
  score: number;
  elements: Element[];
  range?: Range;
  /** Current rectangle of the anchored area in top-level viewport coordinates (null when detached/page). */
  rect: () => Rect | null;
}

const SOURCE_WEIGHT = { selector: 1, section: 0.95, xpath: 0.8, structural: 0.65, text: 0.6 } as const;

function safeQueryAll(root: QueryRoot, sel: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(sel));
  } catch {
    return [];
  }
}

function scoreCandidate(el: Element, t: Partial<AnchorTarget>, sources: Set<keyof typeof SOURCE_WEIGHT>, scrollY: number): number {
  const source = Math.max(...[...sources].map((s) => SOURCE_WEIGHT[s]));
  const agreement = Math.min(0.15, (sources.size - 1) * 0.07);
  const fp = elementText(el);
  const textScore = !t.textFingerprint && !fp ? 1 : !t.textFingerprint ? 0.7 : textSimilarity(t.textFingerprint, fp);
  const tagScore = !t.tag || el.tagName.toLowerCase() === t.tag ? 1 : 0;
  const r = el.getBoundingClientRect();
  let sizeScore = 0.7;
  let posScore = 0.7;
  if (t.rect && t.docRect && (r.width || r.height)) {
    // Only element-sized selections tell us the element's original size.
    if (t.rect.relX === 0 && t.rect.relY === 0 && t.rect.w && t.rect.h) {
      const rw = Math.min(r.width, t.rect.w) / Math.max(r.width, t.rect.w);
      const rh = Math.min(r.height, t.rect.h) / Math.max(r.height, t.rect.h);
      sizeScore = (rw + rh) / 2;
    }
    const dy = Math.abs(r.top + scrollY - (t.docRect.y - t.rect.relY * r.height));
    posScore = Math.max(0, 1 - dy / 2000);
  }
  return Math.min(1, 0.4 * source + 0.3 * textScore + 0.1 * tagScore + 0.1 * sizeScore + 0.1 * posScore + agreement);
}

/** Resolve one target description to the best element (or null if nothing plausible). */
export function resolveTarget(doc: Document, t: Partial<AnchorTarget>, section?: Anchor['section']): ResolvedTarget | null {
  const root = resolveRoot(doc, t.frames, t.shadowHosts);
  if (!root) return null;
  const found = new Map<Element, Set<keyof typeof SOURCE_WEIGHT>>();
  const add = (el: Element | null | undefined, via: keyof typeof SOURCE_WEIGHT) => {
    if (!el || el.closest('[data-pinpoint-root]')) return;
    const s = found.get(el) ?? new Set();
    s.add(via);
    found.set(el, s);
  };
  for (const sel of t.selectors ?? []) {
    const els = safeQueryAll(root, sel);
    if (els.length === 1) add(els[0], 'selector');
    else if (els.length > 1 && els.length <= 20) for (const e of els) add(e, 'text'); // ambiguous: rely on text scoring
  }
  if (t.xpath) add(evalXpath(root, t.xpath), 'xpath');
  if (t.structuralPath) add(safeQueryAll(root, t.structuralPath)[0], 'structural');
  if (section) add(findSectionByInfo(root as Document, section), 'section');
  // Text search among same-tag elements when signals disagree or are missing.
  const best0 = [...found.entries()].some(([, s]) => s.has('selector'));
  if (!best0 && t.textFingerprint && t.tag) {
    const pool = safeQueryAll(root, t.tag).slice(0, 3000);
    for (const e of pool) {
      if (textSimilarity(elementText(e), t.textFingerprint) >= 0.8) add(e, 'text');
    }
  }
  const scrollY = doc.defaultView?.scrollY ?? 0;
  let best: ResolvedTarget | null = null;
  for (const [el, sources] of found) {
    const score = scoreCandidate(el, t, sources, scrollY);
    if (!best || score > best.score) {
      const via = (['selector', 'section', 'xpath', 'structural', 'text'] as const).find((s) => sources.has(s))!;
      best = { el, score, via };
    }
  }
  return best;
}

function rectFor(el: Element, t: Partial<AnchorTarget>, freeRect: boolean): Rect {
  const box = viewportRect(el);
  if (freeRect && t.rect) {
    return { x: box.x + t.rect.relX * box.w, y: box.y + t.rect.relY * box.h, w: t.rect.w, h: t.rect.h };
  }
  return box;
}

export function resolveAnchor(doc: Document, anchor: Anchor, threshold = DETACH_THRESHOLD): ResolvedAnchor {
  if (anchor.scope === 'page') return { state: 'page', score: 1, elements: [], rect: () => null };

  // Text range anchors: find the quote; the range itself is the anchor.
  if (anchor.textRange) {
    const root = resolveRoot(doc, anchor.frames, anchor.shadowHosts);
    const hit = root ? findTextRange(root instanceof Document ? root.body ?? root : root, anchor.textRange) : null;
    if (hit) {
      const range = hit.range;
      const node = range.commonAncestorContainer;
      const el = node.nodeType === 1 ? (node as Element) : node.parentElement!;
      return {
        state: 'attached',
        score: hit.exact ? 1 : 0.75,
        elements: [el],
        range,
        rect: () => {
          const r = range.getBoundingClientRect();
          const box = viewportRect(el);
          const elR = el.getBoundingClientRect();
          return { x: r.left + (box.x - elR.left), y: r.top + (box.y - elR.top), w: r.width, h: r.height };
        },
      };
    }
  }

  const targets: Partial<AnchorTarget>[] = anchor.targets?.length ? anchor.targets : [anchor];
  const resolved = targets.map((t) => resolveTarget(doc, t, anchor.scope === 'section' ? anchor.section : undefined));
  const ok = resolved.filter((r): r is ResolvedTarget => !!r && r.score >= threshold);
  const score = resolved.length ? resolved.reduce((s, r) => s + (r?.score ?? 0), 0) / resolved.length : 0;
  if (!ok.length || (targets.length > 1 && ok.length < Math.ceil(targets.length / 2))) {
    return { state: 'detached', score, elements: [], rect: () => null };
  }
  const elements = ok.map((r) => r.el);
  const free = !!anchor.freeRect;
  return {
    state: 'attached',
    score,
    elements,
    rect: () => {
      const rects = ok.map((r, i) => rectFor(r.el, targets[resolved.indexOf(r)] ?? targets[i], free && i === 0));
      return rects.length === 1 ? rects[0] : unionRects(rects);
    },
  };
}
